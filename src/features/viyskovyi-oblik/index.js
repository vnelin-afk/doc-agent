import { json } from '../../lib/response.js';
import { VO_FIELDS } from './schema.js';

export async function viyskovyiOblikGenerate(request, env, cors) {
	if (!env.VO_SCRIPT_URL) {
		return json({ error: 'VO_SCRIPT_URL not configured' }, cors, 500);
	}

	const data = await request.json();
	// ADR-006: не довіряти структурі без перевірки — розпакувати employees, якщо клієнт випадково загорнув payload у { spec: {...} }.
	const employeesIn = data.employees || data.spec?.employees || [];
	const employees = employeesIn.map(spec => Object.fromEntries(VO_FIELDS.map(f => [f.key, spec[f.key] || ''])));
	const org_name = data.org_name || data.spec?.org_name || env.ORG_NAME || '';

	const scriptRes = await fetch(env.VO_SCRIPT_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify({ employees, org_name }),
	});

	const scriptData = await scriptRes.json();
	return json(scriptData, cors);
}
