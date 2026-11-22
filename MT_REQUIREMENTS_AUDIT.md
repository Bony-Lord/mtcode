# MT Code requirements audit

Дата проверки: 2026-11-22  
Ветка: toicy/personal-workspace  
HEAD: 235da4b0  
Установленная версия: 0.1.69

Статусы отделяют проверенный код от непроверенного внешнего OAuth, реальных лимитов и публикации GitHub.

| Группа | Требование | Статус | Файлы и причина | Следующее исправление или проверка |
|---|---|---|---|---|
| P0 | Возврат из настроек в чат | Частично готово | ChatView, ThreadRouteView и useShownThreadRouteTarget. Browser regression Settings → existing chat → draft проходит, installed route нельзя было переключить во время активной генерации пользователя. | Повторить тот же переход после завершения текущего запуска. |
| P0 | React #301 | Частично готово | useIncrementalTimelineEntries сравнивает содержимое Map, production build и isolated smoke проходят. Установленный 0.1.69 read-only открыт без error boundary, глубокий маршрут не переключался. | Повторить глубокий маршрут после завершения текущего запуска. |
| P0 | Новый, существующий чат и черновики | Частично готово | Browser regression и production smoke проходят, installed path не переключался по причине активной генерации. | Повторить без прерывания пользовательского запуска. |
| P0 | Warning не становится failed | Готово и проверено | Root warning → successful terminal regression добавлена в CodexAdapterV2.test.ts, child warning coverage уже была. | Оставить в общем server test gate. |
| P0 | Раздельные warning, provider error, usage limit, auth error и cancellation | Частично готово | CodexManagedErrors, orchestrationV2ThreadError и agentAwareness покрывают часть классификации. | Свести terminal outcome и UI в тестируемый контракт. |
| P0 | subscription_sharing_unsupported_capability | Готово и проверено | CodexManagedErrors и CodexAdapterV2 сохраняют provider_error, diagnostic и param. | Проверить capability до запуска на живом sharing runtime. |
| P0 | Sharing fallback и запрет повторного несовместимого route | Готово и проверено | Orchestrator и ProviderSwitch.integration.test проверяют другой native thread, очередь и запрет switch-back. | Оставить проверку в общей P0-сборке. |
| P0 | Qwen, Antigravity, OpenCode, OmniRoute и GLM Code | Частично готово | Adapters и fixtures есть, часть instances отключена или требует внешней авторизации. | Fixture smoke и точная причина каждого внешнего отказа. |
| P0 | Auto выбирает разные модели | Частично готово | Catalog и routing paths есть, общей routing matrix нет. | Deterministic test для задач, лимитов и доступности. |
| P0 | Показывать фактическую модель и аккаунт | Частично готово | QuickUsageLimits и provider picker используют runtime selection. | Проверить Auto и смену аккаунта во время запуска. |
| P0 | Лимиты фактической модели и аккаунта | Частично готово | providerUsageDisplaySource и logic tests есть, live rate limits не проверены. | Проверить Codex rate limits без last-run fallback. |
| Аккаунты | Группы, ники, создание, переименование, удаление и отключение | Частично готово | ProviderSettingsPanel, ProviderInstanceCard и AddCodexAccountDialog существуют. | Полный browser regression account lifecycle. |
| Аккаунты | Наследование общих настроек и навыков | Частично готово | Settings и skills paths есть, precedence contract не покрыт. | Test provider → account → project precedence. |
| Аккаунты | Профиль Auto и ручные лимиты | Частично готово | Auto selection и usage UI есть, percentage windows не доказаны полностью. | Schema, persistence и UI test. |
| Аккаунты | Автопереключение при лимите, ошибке и недоступности | Частично готово | Provider switching и quota cooldown реализованы. | Проверить три причины и capability gate. |
| Аккаунты | Все лимиты, карточка Другие аккаунты и Usage menu | Частично готово | QuickUsageLimits и Settings providers есть, aggregate view требует installed check. | Проверить окна, проценты, reset time и закрытие compact panel. |
| Модели | Иконки производителей и теги | Частично готово | ProviderInstanceIcon добавляет OmniRoute, Qwen и web icons. | Сверить полный catalog и убрать случайные fallback icons. |
| Режимы | Auto, Fast, Economy, Conductor, Research, Deep Thinking, Web Search, Keep Awake | Частично готово | agentWorkProfiles содержит основные режимы, полный Keep Awake path не доказан. | Независимые composable toggles и persistence regression. |
| Режимы | Fast, Economy, Conductor и Auto semantics | Частично готово | Shared instructions и subagent capability существуют. | Capability gate, routing matrix и bounded reroute tests. |
| Субагенты | Параллельный запуск, агент/provider/model и warning semantics | Частично готово | Orchestration v2 и projection metadata есть. | Проверить parallel, warning, quota и cancellation. |
| Субагенты | Вопросы, Enter, Ctrl+Enter и Esc | Частично готово | Runtime request и composer handlers существуют. | Browser regression options, queue и immediate cancellation. |
| Контекст | Карта проекта и решений | Частично готово | Internal project-cartographer и project maps существуют, product-visible map не доказана. | Сохранить compact brief и связать с project context. |
| Контекст | Сжатие, архивирование и восстановление истории | Частично готово | Compaction и archived routes есть. | Restore test без потери сообщений. |
| Контекст | Быстрый перенос между провайдерами | Частично готово | Context handoff and provider switch paths есть. | SQLite recovery и queued delivery regression. |
| Контекст | Не пересчитывать неизменённые части | Частично готово | Incremental timeline оптимизирован, #301 был ошибкой сравнения Map. | Сохранить stable projection regression. |
| Проекты | Папки и workspace без обязательного Git | Готово и проверено | Server project model и add-project path поддерживают рабочие папки. | Повторить чистый project smoke. |
| Проекты | Архивирование и восстановление проектов | Частично готово | Project и archived routes есть. | End-to-end archive restore check. |
| Интерфейс | Компактные строки sidebar и перевод на русский | Частично готово | Sidebar CSS и ru-ui.json есть, новые строки частично английские. | Visual check и missing translation scan. |
| Интерфейс | Веб-провайдеры как чат и помощники | Частично готово | web-ai, ACP registry и web skills присутствуют. | Диагностика каждого web adapter. |
| Управление ПК | Capture выключен вне использования, Esc cleanup | Частично готово | Desktop capture lifecycle и cancellation paths есть, live check не выполнен. | Проверить актуальный focused window и отсутствие capture после завершения. |
| Управление ПК | Подготовка, edge effect, пауза и отсутствие жёлтой рамки | Частично готово | UI effects и cleanup paths существуют. | Проверить на установленном клиенте без постоянного capture. |
| GitHub | Теги и Releases Bony-Lord/mtcode | Частично готово | personal remote настроен. Реальные v0.1.63, v0.1.65–v0.1.68 есть, v0.1.64 отсутствует. | Проверить auth и release metadata без подделки истории. |
| GitHub | Personal feed and download defaults | Готово и проверено | branding.ts теперь по умолчанию ссылается на Bony-Lord/mtcode, branding.test.ts проверяет release URL. | Проверить опубликованный feed после отдельного release gate. |
| GitHub | Installer, blockmap, latest.yml, checksum и notes | Частично готово | Локальные release folders и update review есть. | Сверить новую сборку после P0. |
| GitHub | Проверка обновления установленного приложения | Не реализовано | Установлена 0.1.69, текущая правка ещё не упакована. | После P0 собрать следующую свободную версию и проверить обычный update UI. |

## Приоритет

1. Завершить P0 и проверить установленную 0.1.69 без записи пользовательских данных.
2. Закрыть root-warning regression и sharing fallback gate.
3. Проверить Auto, аккаунты, лимиты и provider UI.
4. Проверить adapters и web diagnostics.
5. Собрать следующую свободную версию и только после gates подготовить personal GitHub release.

