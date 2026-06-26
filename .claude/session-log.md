# Session Log — FinAlly

## [2026-06-26] Запуск agent teams, сборка и отладка приложения

### Сделано
- Запущены 6 агентов параллельно (agent teams), каждый написал свою часть:
  - **DB engineer**: `backend/app/db.py`, `backend/db/schema.sql` — 18 тестов ✓
  - **Backend engineer**: FastAPI app, все routes, SSE stream, background tasks — 23 теста ✓
  - **LLM engineer**: `backend/app/llm.py`, `backend/app/routes/chat.py`, Cerebras интеграция — 18 тестов ✓
  - **Frontend engineer**: Next.js UI, все компоненты, SSE hook — 28 тестов ✓, `npm run build` ✓
  - **DevOps engineer**: Dockerfile, docker-compose, скрипты Mac/Windows, .env.example
  - **Integration tester**: 38 Playwright E2E тестов в `test/`

- Docker образ собран и запущен: `docker run -d --name finally-app -v finally-data:/app/db -p 8000:8000`
- Приложение доступно на `http://127.0.0.1:8000`
- Подключён реальный OPENROUTER_API_KEY (из prelegal проекта)

### Баги найдены и исправлены
1. **`undefined.toFixed()`** — `WatchlistPanel` использовал `item.change_pct` которого нет в API, заменено на вычисление из `price`/`prev_price`
2. **SSE парсинг** — фронтенд ожидал один объект, бэкенд слал словарь `{AAPL: {...}, GOOGL: {...}}`. Исправлен `usePriceStream.ts` — итерация по `Object.values(batch)`
3. **`total_pnl` отсутствовал** — добавлены поля `total_pnl` и `total_pnl_pct` в `PortfolioOut` бэкенда
4. **"Trade failed" при успешной сделке** — бэкенд возвращал `{"status": "ok"}`, фронтенд ожидал `{"success": true}`. Добавлен `"success": True` в ответ trade endpoint
5. **QTY input locale bug** — `type="number"` с запятыми (`3,001`) парсился неверно. Заменён на `type="text"` с ручной очисткой

### Текущее состояние
- Приложение полностью работает:
  - Живые цены через SSE (10 тикеров) ✓
  - Watchlist с sparklines ✓
  - Главный график при клике на тикер ✓
  - Portfolio heatmap ✓
  - P&L chart ✓
  - Positions table ✓
  - Ручная торговля BUY/SELL ✓
  - AI chat с реальным LLM (Cerebras via OpenRouter) ✓
  - Total P&L в заголовке ✓
- Ветка: `agent-teams`
- Контейнер: `finally-app`, порт 8000, volume `finally-data`
- `.env`: реальный OPENROUTER_API_KEY, `LLM_MOCK=false`

### Следующие шаги
- Закоммитить все изменения в `agent-teams` ветку
- Сделать PR в main
- Пройти оставшиеся уроки курса

---

## [2026-06-26] Настройка agent teams, подключение GitHub

### Сделано
- Подключён GitHub CLI, GitHub App установлен
- Remote переключён на `ArtemWeb/finaly`
- CLAUDE.md обновлён, ветка `agent-teams` создана
- `settings.json` настроен: плагины + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` + `teammateMode: in-process`

---

## [2026-06-25] Настройка проекта, изучение курса (день 1-2)

### Пройденные уроки курса
1. Slash commands, Agents & Sub-agents, Hooks, Plugins
2. Sandboxing (только Mac/Linux), Claude Code on the Web, GitHub App
3. Large codebases, Agent Teams vs Sub-agents, Agent Teams demo

---
