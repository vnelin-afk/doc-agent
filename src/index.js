import { getNotionClient, getDriveTemplates, generateDoc, handleChat, checkDoc, parseDocPack, getHistory } from './features/docs/index.js';
import { generateTimesheet, previewTimesheet, timesheetFromPack, createTimesheetTemplate } from './features/timesheet/index.js';
import { processPayslip } from './features/payslip/index.js';
import { vacationParse, vacationGenerate } from './features/vacation/index.js';
import { tckParse, tckReparse, handleTckGenerate } from './features/tck/index.js';
import { osobovaParse, handleOsobovaGenerate, osobovaExcelDebug } from './features/osobova/index.js';
import { viyskovyiOblikParse } from './features/viyskovyi-oblik/parser.js';
import { viyskovyiOblikGenerate } from './features/viyskovyi-oblik/index.js';
import { zpVidomistMonobankGenerate } from './features/zp-vidomist-monobank/index.js';
import { json } from './lib/response.js';

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const path = url.pathname;

		const cors = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: cors });
		}

		try {
			// ── Health ──────────────────────────────────────────────────────
			if (path === '/health') return json({ status: 'ok' }, cors);

			// ── Docs (generic) ──────────────────────────────────────────────
			if (path === '/notion/client' && request.method === 'POST') return await getNotionClient(request, env, cors);
			if (path === '/drive/templates' && request.method === 'GET') return await getDriveTemplates(request, env, cors);
			if (path === '/docs/generate' && request.method === 'POST') return await generateDoc(request, env, cors);
			if (path === '/chat' && request.method === 'POST') return await handleChat(request, env, cors);
			if (path === '/docs/check' && request.method === 'POST') return await checkDoc(request, env, cors);
			if (path === '/docs/parse-pack' && request.method === 'POST') return await parseDocPack(request, env, cors);
			if (path === '/history' && request.method === 'GET') return await getHistory(request, env, cors);

			// ── Timesheet (Табель П-5) ──────────────────────────────────────
			if (path === '/docs/timesheet' && request.method === 'POST') return await generateTimesheet(request, env, cors);
			if (path === '/docs/timesheet-preview' && request.method === 'POST') return await previewTimesheet(request, env, cors);
			if (path === '/docs/timesheet-from-pack' && request.method === 'POST') return await timesheetFromPack(request, env, cors);
			if (path === '/docs/create-timesheet-template' && request.method === 'POST') return await createTimesheetTemplate(request, env, cors);

			// ── Payslip (Ecofactor) ─────────────────────────────────────────
			if (path === '/docs/payslip' && request.method === 'POST') return await processPayslip(request, env, cors);

			// ── Vacation (Графік відпусток) ─────────────────────────────────
			if (path === '/docs/vacation-parse' && request.method === 'POST') return await vacationParse(request, env, cors);
			if (path === '/docs/vacation-generate' && request.method === 'POST') return await vacationGenerate(request, env, cors);

			// ── TCK (Повідомлення в ТЦК) ────────────────────────────────────
			if (path === '/docs/tck-parse' && request.method === 'POST') return await tckParse(request, env, cors);
			if (path === '/docs/tck-reparse' && request.method === 'POST') return await tckReparse(request, env, cors);
			if (path === '/docs/tck-generate' && request.method === 'POST') return await handleTckGenerate(request, env, cors);

			// ── Особова картка (П-2) ────────────────────────────────────────
			if (path === '/osobova/parse' && request.method === 'POST') return await osobovaParse(request, env, cors);
			if (path === '/osobova/generate' && request.method === 'POST') return await handleOsobovaGenerate(request, env, cors);
			if (path === '/osobova/excel-debug' && request.method === 'POST') return await osobovaExcelDebug(request, env, cors);
			if (path === '/osobova/access' && request.method === 'GET') {
				const t = url.searchParams.get('t');
				if (!t || t !== env.OSOBOVA_PREVIEW_TOKEN) return json({ ok: false }, cors, 403);
				return json({ ok: true }, cors);
			}

			// ── Список персонального військового обліку (Додаток 5) ─────────
			if (path === '/docs/viyskovyi-oblik-parse' && request.method === 'POST') return await viyskovyiOblikParse(request, env, cors);
			if (path === '/docs/viyskovyi-oblik-generate' && request.method === 'POST') return await viyskovyiOblikGenerate(request, env, cors);
			if (path === '/docs/viyskovyi-oblik-access' && request.method === 'GET') {
				const t = url.searchParams.get('t');
				if (!t || t !== env.OSOBOVA_PREVIEW_TOKEN) return json({ ok: false }, cors, 403);
				return json({ ok: true }, cors);
			}

			// ── Відомість ЗП для monobank ────────────────────────────────────
			if (path === '/docs/zp-vidomist-monobank-generate' && request.method === 'POST') return await zpVidomistMonobankGenerate(request, env, cors);

			return json({ error: 'Not found' }, cors, 404);
		} catch (e) {
			return json({ error: e.message }, cors, 500);
		}
	},
};
