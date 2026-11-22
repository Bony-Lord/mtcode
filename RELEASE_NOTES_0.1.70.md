# MT Code 0.1.70 release notes

## Исправлено

- Устранён React #301 при рендере ChatView и ChatComposer. Пересоздаваемая карта предпросмотров вложений больше не вызывает бесконечный render-phase update.
- Добавлена проверка восстановления server chat → Settings → server chat → draft.
- Разорван импортный цикл composerDraftStore → modelSelection → composerProviderState → TraitsPicker.
- Предупреждение Codex сохраняется как warning system notice и не превращает успешный terminal turn в failed.
- Сохранена диагностика subscription_sharing_unsupported_capability и безопасное продолжение через другой provider thread.
- Баннер отклонённой отправки сменяется актуальным состоянием после нового запуска или новой ошибки. Исходный отказ ChatGPT sharing остаётся в истории.
- Кнопка «Не спать» рядом с режимами агента использует общую настройку среды и сочетается с выбранными режимами.
- Ссылки release notes и update history по умолчанию указывают на личный форк Bony-Lord/mtcode.

## Проверено

- Production web build.
- Изолированный запуск Windows x64 из установщика. Открытие нового черновика и сохранённого чата, возврат по Esc из настроек и переход обратно к черновику.
- Регрессии ChatView проверяют продолжение после отклонённой отправки и показ нового сообщения о лимите.
- Server regression для root warning, Codex sharing fallback и active-writer protection.
- Web typecheck и formatting.

## Ограничения перед публикацией

- Переходы проверены в отдельном профиле 0.1.70. Ход активных сессий и установленный клиент не затрагивались.
