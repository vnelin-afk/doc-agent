
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers для Artifact
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    try {
      // Маршрути
      if (path === '/health') {
        return json({ status: 'ok' }, cors);
      }

      if (path === '/notion/client' && request.method === 'POST') {
        return await getNotionClient(request, env, cors);
      }

      if (path === '/drive/templates' && request.method === 'GET') {
        return await getDriveTemplates(request, env, cors);
      }

      if (path === '/docs/generate' && request.method === 'POST') {
        return await generateDoc(request, env, cors);
      }

      if (path === '/chat' && request.method === 'POST') {
        return await handleChat(request, env, cors);
      }

      if (path === '/docs/check' && request.method === 'POST') {
        return await checkDoc(request, env, cors);
      }

      if (path === '/docs/parse-pack' && request.method === 'POST') {
        return await parseDocPack(request, env, cors);
      }

      if (path === '/docs/timesheet' && request.method === 'POST') {
        return await generateTimesheet(request, env, cors);
      }

      if (path === '/docs/create-timesheet-template' && request.method === 'POST') {
        return await createTimesheetTemplate(request, env, cors);
      }

      if (path === '/docs/timesheet-from-pack' && request.method === 'POST') {
        return await timesheetFromPack(request, env, cors);
      }

      return json({ error: 'Not found' }, cors, 404);

    } catch (e) {
      return json({ error: e.message }, cors, 500);
    }
  }
};

// --- Notion: отримати клієнта за назвою ---
async function getNotionClient(request, env, cors) {
  const { name } = await request.json();

  const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        or: [
          { property: 'Назва компанії', title: { contains: name } },
          { property: 'ЄДРПОУ компанії', rich_text: { equals: name } },
          { property: 'Публічна назва', rich_text: { contains: name } },
        ]
      }
    })
  });

  const data = await res.json();

  if (!data.results?.length) {
    return json({ error: 'Client not found' }, cors, 404);
  }

  const page = data.results[0];
  const props = page.properties;

  const client = {
    id: page.id,
    name: props['Назва компанії']?.title?.[0]?.plain_text ?? '',
    edrpou: props['ЄДРПОУ компанії']?.rich_text?.[0]?.plain_text ?? '',
    email: props['Email']?.rich_text?.[0]?.plain_text ?? '',
    director: props['Директор (підписант)']?.rich_text?.[0]?.plain_text ?? '',
    status: props['Status']?.status?.name ?? '',
    drive_folder: props['Папка на диску']?.url ?? '',
  };

  return json({ client }, cors);
}

// --- Drive: список шаблонів ---
async function getDriveTemplates(request, env, cors) {
  const token = await getGoogleToken(env);

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${env.TEMPLATES_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  const data = await res.json();
  return json({ templates: data.files }, cors);
}

// --- Notion: парсер типів полів ---
function parseNotionProperty(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return prop.title?.[0]?.plain_text ?? '';
    case 'rich_text':
      return prop.rich_text?.[0]?.plain_text ?? '';
    case 'date':
      return prop.date?.start
        ? new Date(prop.date.start).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';
    case 'status':
      return prop.status?.name ?? '';
    case 'select':
      return prop.select?.name ?? '';
    case 'number':
      return prop.number?.toString() ?? '';
    case 'checkbox':
      return prop.checkbox ? 'Так' : 'Ні';
    case 'url':
      return prop.url ?? '';
    case 'email':
      return prop.email ?? '';
    case 'phone_number':
      return prop.phone_number ?? '';
    case 'formula':
      return prop.formula?.string ?? prop.formula?.number?.toString() ?? '';
    case 'rollup':
      return prop.rollup?.array?.[0]?.title?.[0]?.plain_text ?? '';
    case 'people':
      return prop.people?.map(p => p.name).join(', ') ?? '';
    case 'relation':
      return '';
    default:
      return '';
  }
}

// --- Google Docs: генерація документу ---
async function generateDoc(request, env, cors) {
  const { edrpou, templateId, sessionName } = await request.json();
  const token = await getGoogleToken(env);

  // 1. Отримати клієнта з Notion
  const notionRes = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: { property: 'ЄДРПОУ компанії', rich_text: { equals: edrpou } }
    })
  });
  const notionData = await notionRes.json();
  if (!notionData.results?.length) return json({ error: 'Client not found' }, cors, 404);

  const props = notionData.results[0].properties;
  const client = {};
  for (const [key, value] of Object.entries(props)) {
    client[`{{${key}}}`] = parseNotionProperty(value);
  }

  // 2. Створити папку сесії
  const today = new Date().toISOString().slice(0, 10);
  const folderName = `${today} ${sessionName || 'Генерація'}`;
  const folderRes = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [env.RESULTS_FOLDER_ID],
    })
  });
  const folder = await folderRes.json();

  // 3. Скопіювати шаблон
  const docName = `${today}_${edrpou}_${sessionName || 'Документ'}`;
  const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: docName, parents: [folder.id] })
  });
  const doc = await copyRes.json();
  console.log('Copy response:', JSON.stringify(doc));
  console.log('Folder response:', JSON.stringify(folder));

  // 4. Замінити плейсхолдери
  const requests = Object.entries(client).map(([placeholder, value]) => ({
    replaceAllText: {
      containsText: { text: placeholder, matchCase: true },
      replaceText: value,
    }
  }));

  await fetch(`https://docs.googleapis.com/v1/documents/${doc.id}:batchUpdate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });

  return json({
    docId: doc.id,
    docName: doc.name,
    link: `https://docs.google.com/document/d/${doc.id}/edit`,
    folder: folderName,
  }, cors);
}

// --- Claude: chat з агентом ---
async function handleChat(request, env, cors) {
  const { messages, state } = await request.json();

  const systemPrompt = `Ти — document agent для компанії FinServ. Допомагаєш генерувати документи для клієнтів.

Твої інструменти (викликай через JSON в полі "action"):
- get_client: отримати клієнта з Notion. Параметри: { name: string } — передавай те що написав юзер
- get_templates: отримати список шаблонів з Drive. Без параметрів.
- generate_doc: згенерувати документ. Параметри: { edrpou: string, templateId: string, sessionName: string }
- ask_user: запитати користувача. Параметри: { question: string }
- done: завершити. Параметри: { message: string, link: string }

Поточний стан: ${JSON.stringify(state || {})}

Правила:
1. Якщо запит про генерацію — спочатку виклич get_client, потім get_templates
2. Якщо в стані вже є client і templates — запропонуй юзеру вибрати шаблон зі списку і підтвердити
3. Якщо юзер вибрав шаблон або підтвердив — виклич generate_doc з edrpou клієнта і templateId
4. Після generate_doc виклич done
5. Якщо даних не вистачає — виклич ask_user
6. Відповідай ТІЛЬКИ валідним JSON: { "text": "...", "action": { "type": "...", "params": {...} } }
7. Якщо дія не потрібна — не включай поле action
8. В полі text завжди пиши зрозуміло що відбувається або що потрібно від юзера

КРИТИЧНО: Ти ЗАВЖДИ відповідаєш ТІЛЬКИ валідним JSON об'єктом. Ніякого тексту поза JSON. Ніяких пояснень. Тільки: {"text":"...","action":{...}} або {"text":"..."} якщо дія не потрібна. Якщо потрібно викликати інструмент — обов'язково включай "action".`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    })
  });

  const data = await res.json();
  const content = data.content?.[0]?.text ?? '{}';

  let parsed;
  try {
    const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    parsed = { text: content };
  }

  return json(parsed, cors);
}

// --- Docs: перевірка документу ---
async function checkDoc(request, env, cors) {
  const { docId } = await request.json();
  const token = await getGoogleToken(env);

  const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const doc = await docRes.json();

  const text = doc.body?.content
    ?.map(b => b.paragraph?.elements?.map(e => e.textRun?.content).join(''))
    .filter(Boolean)
    .join('\n') ?? '';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: 'Ти редактор документів. Перевір документ. Відповідай ТІЛЬКИ валідним JSON без жодного тексту до або після: { "ok": true, "issues": [] } або { "ok": false, "issues": ["опис проблеми"] }',
      messages: [{ role: 'user', content: text }],
    })
  });

  const data = await res.json();
  const content = data.content?.[0]?.text ?? '{}';
  let parsed;
  try {
    const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { ok: false, issues: [content] };
  } catch {
    parsed = { ok: false, issues: [content] };
  }

  return json(parsed, cors);
}

async function parseDocPack(request, env, cors) {
  const formData = await request.formData();
  const employees = [];
  let org = null;

  for (const [_key, file] of formData.entries()) {
    if (!(file instanceof File)) continue;

    console.log('File name:', file.name, 'size:', file.size);
    const fileName = file.name.toLowerCase();
    const isPdf = fileName.endsWith('.pdf');
    const isDocx = fileName.endsWith('.docx');

    if (!isPdf && !isDocx) continue;

    let claudeMessages;
    let claudeContent;

    if (isPdf) {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      claudeContent = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }];
      claudeMessages = [{ role: 'user', content: claudeContent }];
    } else {
      const buffer = await file.arrayBuffer();
      claudeContent = await extractDocxText(buffer);
      claudeMessages = [{ role: 'user', content: claudeContent }];
    }

    console.log('Extracted text preview:', typeof claudeContent === 'string' ? claudeContent.slice(0, 500) : JSON.stringify(claudeContent).slice(0, 500));

    if (typeof claudeContent === 'string' && claudeContent.length < 20) {
      employees.push({ error: 'empty_content', source_file: file.name });
      continue;
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        ...(isPdf ? { 'anthropic-beta': 'pdfs-2024-09-25' } : {}),
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: `Витягни дані про працівника з наказу про прийняття на роботу. Відповідай ТІЛЬКИ валідним JSON без тексту до або після:
{
  "full_name": "ПІБ у називному відмінку",
  "position": "посада",
  "start_date": "YYYY-MM-DD",
  "employment_type": "full" або "part",
  "work_days": "all" або ["monday","friday",...],
  "hours_per_day": 8,
  "org_name": "повна назва організації з документу капсом",
  "edrpou": "код ЄДРПОУ",
  "director_name": "ПІБ директора у називному відмінку"
}

Правила:
- position: завжди у називному відмінку. Якщо в тексті 'на посаду директора' → 'директор', 'на посаду операційного менеджера' → 'операційний менеджер', 'на посаду розробника' → 'розробник', 'на посаду директора технічного' → 'директор технічний'
- employment_type: "full" якщо основне місце без обмежень; "part" якщо сумісництво або неповний день/тиждень
- work_days: "all" якщо всі робочі дні; масив конкретних днів якщо вказані в наказі (наприклад ["friday"] для "робочий день п'ятниця")
- hours_per_day: рахуй так: якщо графік '09:00 до 18:00' — це 8 годин (віднімай 1 год обідньої перерви). Формула: (година_кінця - година_початку - 1). Якщо не вказано і full → 8; якщо part і не вказано → 4
- full_name ЗАВЖДИ у форматі 'Прізвище Ім'я По-батькові'. Прізвище — зазвичай слово що закінчується на -ко, -ів, -аг, -ський, -зький або стоїть першим у рядку 'Я, ПРІЗВИЩЕ ІМ'Я ПО-БАТЬКОВІ'. Шукай рядок що починається з 'Я,' або 'приступаю до виконання' — там ПІБ у називному відмінку і правильному порядку. Завжди повертай: Прізвище першим.`,
        messages: claudeMessages,
      })
    });

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text ?? '{}';
    try {
      const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean);

      if (!parsed.full_name) {
        employees.push({ error: 'empty_parse', raw: content, source_file: file.name });
        continue;
      }

      parsed.full_name = normalizeFullName(parsed.full_name);

      if (!org && parsed.org_name) {
        org = {
          org_name: parsed.org_name,
          edrpou: parsed.edrpou || '',
          director_name: parsed.director_name || '',
        };
      }

      const gender = detectGender(parsed.full_name);
      const name_short = formatShortName(parsed.full_name, parsed.position);

      employees.push({
        full_name: parsed.full_name,
        position: parsed.position,
        start_date: parsed.start_date,
        employment_type: parsed.employment_type,
        work_days: parsed.work_days,
        hours_per_day: parsed.hours_per_day,
        gender,
        name_short,
      });
    } catch {
      employees.push({ error: 'parse_failed', raw: content, source_file: file.name });
    }
  }

  return json({ employees, org, count: employees.length }, cors);
}

async function generateTimesheet(request, env, cors) {
  const data = await request.json();
  const { employees, year, month, exceptions = {} } = data;

  const workingDays = getWorkingDays(year, month);

  const rows = employees.map(emp => {
    const days = {};
    for (const day of workingDays) {
      const date = new Date(year, month - 1, day);
      const dayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][date.getDay()];
      const exKey = `${emp.full_name}_${day}`;

      if (exceptions[exKey]) {
        days[day] = exceptions[exKey];
      } else if (emp.work_days === 'all' || emp.work_days?.includes(dayName)) {
        const code = emp.employment_type === 'full' ? 'Р' : 'РС';
        days[day] = { code, hours: emp.hours_per_day || 8 };
      }
    }

    const totalDays = Object.keys(days).length;
    const totalHours = Object.values(days).reduce((sum, d) => sum + (d.hours || 0), 0);

    return {
      full_name: emp.full_name,
      position: emp.position,
      name_short: emp.name_short,
      gender: emp.gender,
      days,
      total_days: totalDays,
      total_hours: totalHours,
    };
  });

  const spec = {
    employees: rows.map((r, i) => ({
      index: i + 1,
      tabNumber: r.tab_number || String(i + 1),
      gender: r.gender || 'ч',
      name: r.name_short || `${r.full_name}, ${r.position}`,
      days: Array.from({ length: 31 }, (_, d) => {
        const day = r.days[d + 1];
        return day ? { code: day.code, hours: day.hours } : { code: '-', hours: '-' };
      }),
      summary: {
        days: String(r.total_days),
        hours: String(r.total_hours),
        total: String(r.total_hours),
        overtime: '',
        night: '',
        evening: '',
        weekend: '',
      }
    })),
    total: {
      days: String(rows.reduce((s, r) => s + r.total_days, 0)),
      hours: String(rows.reduce((s, r) => s + r.total_hours, 0)),
      total: String(rows.reduce((s, r) => s + r.total_hours, 0)),
      overtime: '', night: '', evening: '', weekend: '',
    }
  };

  // Відправляємо в Apps Script
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyWwxaqvGLz0qqYgpPJe-BanyI9UNF34tQvsrhGhCjyFqVGIG8hcnKW03B8vq_V63RW/exec';

  const payload = {
    org_name: data.org_name || data.org?.org_name || env.ORG_NAME || '',
    edrpou: data.edrpou || data.org?.edrpou || '',
    fill_date: data.fill_date || '',
    period_from: data.period_from || '',
    period_to: data.period_to || '',
    sign_date: data.sign_date || '',
    director_name: formatDirectorName(data.director_name || data.org?.director_name || ''),
    employees: spec.employees,
    total: spec.total,
  };

  console.log('Sending to Apps Script, org_name:', payload.org_name, 'director:', payload.director_name);
  console.log('Payload to Apps Script:', JSON.stringify(payload).slice(0, 500));

  const scriptRes = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  const scriptData = await scriptRes.json();
  return json(scriptData, cors);
}

async function timesheetFromPack(request, env, cors) {
  const formData = await request.formData();

  // --- Step 1: extract meta fields ---
  const year      = Number(formData.get('year'));
  const month     = Number(formData.get('month'));
  const fill_date   = formData.get('fill_date')   || '';
  const period_from = formData.get('period_from') || '';
  const period_to   = formData.get('period_to')   || '';
  const sign_date   = formData.get('sign_date')   || '';

  // --- Step 2: parse files (identical logic to parseDocPack) ---
  const employees = [];
  let org = null;

  for (const [_key, file] of formData.entries()) {
    if (!(file instanceof File)) continue;

    const fileName = file.name.toLowerCase();
    const isPdf  = fileName.endsWith('.pdf');
    const isDocx = fileName.endsWith('.docx');
    if (!isPdf && !isDocx) continue;

    console.log('File name:', file.name, 'size:', file.size);

    let claudeMessages;
    let claudeContent;

    if (isPdf) {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      claudeContent = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }];
      claudeMessages = [{ role: 'user', content: claudeContent }];
    } else {
      const buffer = await file.arrayBuffer();
      claudeContent = await extractDocxText(buffer);
      claudeMessages = [{ role: 'user', content: claudeContent }];
    }

    console.log('Extracted text preview:', typeof claudeContent === 'string' ? claudeContent.slice(0, 500) : JSON.stringify(claudeContent).slice(0, 500));

    if (typeof claudeContent === 'string' && claudeContent.length < 20) {
      employees.push({ error: 'empty_content', source_file: file.name });
      continue;
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        ...(isPdf ? { 'anthropic-beta': 'pdfs-2024-09-25' } : {}),
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: `Витягни дані про працівника з наказу про прийняття на роботу. Відповідай ТІЛЬКИ валідним JSON без тексту до або після:
{
  "full_name": "ПІБ у називному відмінку",
  "position": "посада",
  "start_date": "YYYY-MM-DD",
  "employment_type": "full" або "part",
  "work_days": "all" або ["monday","friday",...],
  "hours_per_day": 8,
  "org_name": "повна назва організації з документу капсом",
  "edrpou": "код ЄДРПОУ",
  "director_name": "ПІБ директора у називному відмінку"
}

Правила:
- position: завжди у називному відмінку. Якщо в тексті 'на посаду директора' → 'директор', 'на посаду операційного менеджера' → 'операційний менеджер', 'на посаду розробника' → 'розробник', 'на посаду директора технічного' → 'директор технічний'
- employment_type: "full" якщо основне місце без обмежень; "part" якщо сумісництво або неповний день/тиждень
- work_days: "all" якщо всі робочі дні; масив конкретних днів якщо вказані в наказі (наприклад ["friday"] для "робочий день п'ятниця")
- hours_per_day: рахуй так: якщо графік '09:00 до 18:00' — це 8 годин (віднімай 1 год обідньої перерви). Формула: (година_кінця - година_початку - 1). Якщо не вказано і full → 8; якщо part і не вказано → 4
- full_name ЗАВЖДИ у форматі 'Прізвище Ім'я По-батькові'. Прізвище — зазвичай слово що закінчується на -ко, -ів, -аг, -ський, -зький або стоїть першим у рядку 'Я, ПРІЗВИЩЕ ІМ'Я ПО-БАТЬКОВІ'. Шукай рядок що починається з 'Я,' або 'приступаю до виконання' — там ПІБ у називному відмінку і правильному порядку. Завжди повертай: Прізвище першим.
- full_name ЗАВЖДИ у форматі 'Прізвище Ім'я По-батькові'. Прізвище — це перше слово. Наприклад: 'Карпенко Сергій Вікторович', 'Боклаг Роман Валентинович'. НІКОЛИ не починай з імені.`,
        messages: claudeMessages,
      })
    });

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text ?? '{}';
    try {
      const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean);

      if (!parsed.full_name) {
        employees.push({ error: 'empty_parse', raw: content, source_file: file.name });
        continue;
      }

      parsed.full_name = normalizeFullName(parsed.full_name);

      if (!org && parsed.org_name) {
        org = {
          org_name: parsed.org_name,
          edrpou: parsed.edrpou || '',
          director_name: parsed.director_name || '',
        };
      }

      const gender = detectGender(parsed.full_name);
      const name_short = formatShortName(parsed.full_name, parsed.position);

      employees.push({
        full_name: parsed.full_name,
        position: parsed.position,
        start_date: parsed.start_date,
        employment_type: parsed.employment_type,
        work_days: parsed.work_days,
        hours_per_day: parsed.hours_per_day,
        gender,
        name_short,
      });
    } catch {
      employees.push({ error: 'parse_failed', raw: content, source_file: file.name });
    }
  }

  // --- Step 3: construct fake Request and call generateTimesheet ---
  const body = JSON.stringify({
    employees,
    org,
    year,
    month,
    fill_date,
    period_from,
    period_to,
    sign_date,
  });

  const fakeRequest = new Request('https://internal/docs/timesheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return await generateTimesheet(fakeRequest, env, cors);
}

async function createTimesheetTemplate(request, env, cors) {
  const { companyName, edrpou, periodStart, periodEnd, fillDate, folderId } = await request.json();
  const token = await getGoogleToken(env);
  const BASE_TEMPLATE_ID = '1ls3WmasqXfYqIsprFBQ_CHU9acGAv6oyaKUlUgXhr4Q';

  const copyRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${BASE_TEMPLATE_ID}/copy?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Табель_${companyName}_${periodStart}`,
      parents: [folderId || env.RESULTS_FOLDER_ID]
    })
  });
  const copyData = await copyRes.json();
  const docId = copyData.id;
  if (!docId) return json({ error: 'copy_failed', detail: copyData }, cors, 500);

  const text = [
    'ТАБЕЛЬ ОБЛІКУ ВИКОРИСТАННЯ РОБОЧОГО ЧАСУ\n',
    `${companyName}\n`,
    `Ідентифікаційний код ЄДРПОУ ${edrpou}\n`,
    `Звітний період: ${periodStart} — ${periodEnd}\n`,
    `Дата заповнення: ${fillDate}\n`,
  ].join('');

  await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        { insertText: { location: { index: 1 }, text } }
      ]
    })
  });

  return json({
    docId,
    link: `https://docs.google.com/document/d/${docId}/edit`,
  }, cors);
}

async function extractDocxText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let xmlBytes;
  try {
    xmlBytes = await unzipFile(bytes, 'word/document.xml');
  } catch (e) {
    console.error('unzipFile error:', e.message);
    return '';
  }
  if (!xmlBytes) return '';

  let xmlContent = new TextDecoder('utf-8').decode(xmlBytes);
  if (!/[а-яА-ЯіІїЇєЄ]/.test(xmlContent)) {
    xmlContent = new TextDecoder('windows-1251').decode(xmlBytes);
  }

  const matches = xmlContent.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g);
  const text = [...matches].map(m => m[1]).join(' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');

  return text.replace(/\s+/g, ' ').trim();
}

async function unzipFile(bytes, targetPath) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Step 1: Find End of Central Directory (EOCD) — scan from end
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize   = view.getUint32(eocdOffset + 12, true);

  // Step 2: Scan Central Directory
  let offset = cdOffset;
  while (offset < cdOffset + cdSize) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x02014b50) break;

    const cdFlags   = view.getUint16(offset + 8,  true);
    const compMethod = view.getUint16(offset + 10, true);
    const compSize   = view.getUint32(offset + 20, true);

    const nameLen    = view.getUint16(offset + 28, true);
    const extraLen   = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLen);
    const nameEncoding = (cdFlags & 0x800) ? 'utf-8' : 'utf-8';
    const name = new TextDecoder(nameEncoding).decode(nameBytes);

    if (name === targetPath) {
      // Step 3: Jump to local file header
      const localSig = view.getUint32(localOffset, true);
      if (localSig !== 0x04034b50) {
        throw new Error(`Invalid ZIP local file header signature 0x${localSig.toString(16)} at offset ${localOffset}`);
      }

      const localNameLen  = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLen + localExtraLen;

      const compressedData = bytes.slice(dataOffset, dataOffset + compSize);

      if (compMethod === 0) {
        return compressedData;
      } else if (compMethod === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();

        writer.write(compressedData);
        writer.close();

        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalLength);
        let pos = 0;
        for (const chunk of chunks) {
          result.set(chunk, pos);
          pos += chunk.length;
        }
        return result;
      }
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return null;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.slice(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

function normalizeFullName(fullName) {
  if (!fullName) return fullName;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length !== 3) return fullName;

  const [a, b, c] = parts;

  // Патронім закінчується на -ович, -евич, -євич, -овна, -евна, -євна
  const patronymicEndings = ['ович', 'евич', 'євич', 'овна', 'евна', 'євна'];
  const isPatronymic = (w) => patronymicEndings.some(e => w.toLowerCase().endsWith(e));

  // Якщо третє слово — патронім, порядок правильний: Прізвище Ім'я По-батькові
  if (isPatronymic(c)) return fullName;

  // Якщо друге слово — патронім: малоймовірно, але переставляємо
  if (isPatronymic(b)) return `${b} ${a} ${c}`;

  // Якщо перше слово — патронім: пробуємо переставити
  if (isPatronymic(a)) return `${b} ${c} ${a}`;

  // Якщо перше слово схоже на ім'я — переставляємо: Ім'я Прізвище По-батькові → Прізвище Ім'я По-батькові
  const firstNames = new Set(['сергій','іван','роман','андрій','володимир','олег','микола','василь','петро','олексій','дмитро','максим','артем','богдан','юрій','віктор','павло','михайло','ігор','євген','марія','анна','олена','наталія','тетяна','юлія','ірина','світлана','оксана','галина','валентина','надія','вікторія','катерина','аліна','дарина']);

  if (firstNames.has(a.toLowerCase()) && !firstNames.has(b.toLowerCase())) {
    return `${b} ${a} ${c}`;
  }

  return fullName;
}

function detectGender(fullName) {
  if (!fullName) return 'ч';
  const parts = fullName.trim().split(/\s+/);
  const firstName = (parts[1] || '').toLowerCase();
  const patronymic = (parts[2] || '').toLowerCase();

  const femaleNames = ['марія','анна','олена','наталія','наталя','тетяна','юлія','ірина','світлана','людмила','оксана','галина','валентина','ніна','лариса','тамара','надія','вікторія','катерина','олеся','аліна','дарина','христина','поліна','діана','софія','ксенія','вероніка','жанна','лілія','інна','алла','зоя','єлизавета','влада','сніжана'];

  if (femaleNames.includes(firstName)) return 'ж';
  if (/[вв]на$/.test(patronymic) || /івна$/.test(patronymic) || /ївна$/.test(patronymic)) return 'ж';
  return 'ч';
}

function formatDirectorName(fullName) {
  if (!fullName) return fullName;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  // Input is "Прізвище Ім'я По-батькові" → output "Ім'я Прізвище"
  const surname = parts[0];
  const firstName = parts[1];
  return `${firstName} ${surname}`;
}

function formatShortName(fullName, position) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  const last = parts[0] || '';
  const firstInitial = parts[1] ? parts[1][0] + '.' : '';
  const patronymicInitial = parts[2] ? parts[2][0] + '.' : '';
  return `${last} ${firstInitial}${patronymicInitial}, ${position || ''}`.trim();
}

function getWorkingDays(year, month) {
  const days = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) days.push(d);
  }
  return days;
}

// --- Google Service Account token ---
async function getGoogleToken(env) {
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const payload = btoa(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  return data.access_token;
}

function pemToArrayBuffer(pem) {
  pem = pem.replace(/\\n/g, '\n');
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

function json(data, cors, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}