export async function getGoogleToken(env) {
	const now = Math.floor(Date.now() / 1000);

	const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');

	const payload = btoa(
		JSON.stringify({
			iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
			scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets',
			aud: 'https://oauth2.googleapis.com/token',
			exp: now + 3600,
			iat: now,
		}),
	)
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');

	const signingInput = `${header}.${payload}`;

	const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);

	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));

	const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');

	const jwt = `${signingInput}.${sig}`;

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
	});

	const data = await res.json();
	return data.access_token;
}

export function pemToArrayBuffer(pem) {
	pem = pem.replace(/\\n/g, '\n');
	const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
	const bin = atob(b64);
	const buf = new ArrayBuffer(bin.length);
	const view = new Uint8Array(buf);
	for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
	return buf;
}
