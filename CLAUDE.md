# Claude Code — doc-agent

## Vault
```
VAULT: C:\Users\ewtiu\OneDrive\Документи\Obsidian Vault
PROJECT: doc-agent
STACK: Cloudflare Workers, Vanilla JS, Google Apps Script, Claude Haiku
```

## Перед кожною задачею
1. Читай PLAN.md → якщо SYNC_REQUIRED: YES → перечитай всі 4 файли нижче
2. Контекст: SPEC.md, PLAN.md, tasks.md, ARCHITECTURE.md
3. Виконай задачу

## Після кожної задачі
Оновлення в Obsidian: ARCHITECTURE.md, CHANGELOG.md, tasks.md (DONE + timestamp)
Повідом: "Task #N complete. Changes: [список]. Review before #N+1."

## Ескалація
- Дрібний баг → фіксуй і продовжуй
- Складний баг → досліджуй → пропонуй → чекай дозволу
- Архітектурний конфлікт → стоп → документуй в ARCHITECTURE.md → скажи користувачу звернутись до Cowork

## Заборонено
- Переходити до наступної задачі без дозволу
- Змінювати SPEC.md або PLAN.md
- Переробляти архітектуру без Cowork

## Obsidian MCP — технічні обмеження
`obsidian_patch_content` з `target_type: heading` працює **тільки для H1 (`#`)**.
H2 (`##`) і глибше — завжди `invalid-target`.

| Ситуація | Інструмент |
|---|---|
| Замінити контент під H1 | `obsidian_patch_content` |
| Додати в H2+ / новий файл / кінець файлу | `obsidian_append_content` |

---

## Команди

```bash
npm run dev        # Start local development server via Wrangler
npm run deploy     # Deploy to Cloudflare Workers
npm test           # Run tests with Vitest
```

## Архітектура

Cloudflare Worker. Точка входу: `src/index.js` — єдиний `fetch()` handler, маршрутизує всі HTTP запити. CORS headers на кожній відповіді.

### Key Integrations

| Інтеграція | Деталі |
|-----------|--------|
| **Google APIs** (Drive, Docs, Sheets) | Raw `fetch()` + JWT auth із service account. Без Google SDK. |
| **Notion API** | Lookup клієнтів/компаній для генерації документів |
| **Claude AI** | Парсинг документів (vision), валідація, `/chat` agentic loop. Model: `claude-haiku-4-5-20251001` |
| **Google Apps Script** | Webhook для обробки payslip і генерації документів |

### Secrets / Environment Variables

| Variable | Purpose |
|----------|---------|
| `CLAUDE_API_KEY` | Anthropic API key |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google service account |
| `GOOGLE_PRIVATE_KEY` | PEM-format private key |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_DB_ID` | Notion database ID for clients |
| `TEMPLATES_FOLDER_ID` | Google Drive templates folder |
| `RESULTS_FOLDER_ID` | Google Drive output folder (`1G5DbiCGHoFCCCnuny0qrWliyYVN1F_lR`) |
| `ORG_NAME` | Default organization name |
| `ECOFACTOR_SCRIPT_URL` | Google Apps Script webhook URL |
| `ECOFACTOR_SHEET_ID` | Google Sheets ID for payslips |
| `APPS_SCRIPT_TCK_URL` | Apps Script URL для ТЦК генерації |
| `NOTION_TCK_DB_ID` | Notion DB "Роботодавці" для ТЦК |
| `TCK_COVER_LETTER_TEMPLATE` | Google Doc template ID — Супровідний лист |
| `TCK_ANNEX4_TEMPLATE` | Google Doc template ID — Додаток 4 |

## Code Style
Prettier (`.prettierrc`): tab indentation, single quotes, semicolons, 140-char print width.

## Response Style
- Be concise. No preamble, no summaries after changes.
- Don't explain what you're about to do — just do it.
- If unsure about scope, ask ONE clarifying question before starting.

## Working Rules
- Always check existing patterns before introducing new ones.
- Cloudflare Worker — no Node.js APIs, no `require()`, no native modules.
- All Google API calls use raw `fetch()` with JWT auth — never suggest adding a Google SDK.
- Prefer editing existing functions over creating new ones.