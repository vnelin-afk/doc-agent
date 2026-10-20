export function json(data, cors, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...cors, 'Content-Type': 'application/json' },
	});
}
