# MT Code 0.1.70 release notes

## Исправлено

- Устранён React #301 при рендере ChatView и ChatComposer. Пересоздаваемая карта предпросмотров вложений больше не вызывает бесконечный render-phase update.
- Добавлена проверка восстановления server chat → Settings → server chat → draft.
- Разорван импортный цикл composerDraftStore → modelSelection → composerProviderState → TraitsPicker.
- Предупреждение Codex сохраняется как warning system notice и не превращает успешный terminal turn в failed.
- Сохранена диагностика subscription_sharing_unsupported_capability и безопасное продолжение через другой provider thread.
- Ссылки release notes и update history по умолчанию указывают на личный форк Bony-Lord/mtcode.

## Проверено

- Production web build.
- Browser regression для ChatView, draft recovery и settings return path.
- Server regression для root warning, Codex sharing fallback и active-writer protection.
- Web typecheck и formatting.
- Установленная 0.1.69 открывает текущий чат без error boundary при read-only проверке.

## Ограничения перед публикацией

- Глубокий переход в установленном 0.1.69 не выполнялся, потому что в окне пользователя шла активная генерация.
- GitHub Release, tag, installer, blockmap, latest.yml и checksum для 0.1.70 ещё не опубликованы.

