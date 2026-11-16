process.env.MTCODE_IMPORT_ALL_HISTORY ??= "1";
// Personal builds must not be silently replaced by an upstream stable installer.
process.env.T3CODE_DISABLE_AUTO_UPDATE ??= "1";
require("./compileCache.cjs");
require("./main.cjs");
