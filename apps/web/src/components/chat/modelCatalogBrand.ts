const gatewaySources: Readonly<Record<string, { name: string; url: string }>> = {
  "qwen-free": { name: "OVHcloud", url: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/" },
  "omniroute-free": { name: "OmniRoute", url: "http://127.0.0.1:20128/dashboard/providers" },
  "kilo-free": { name: "Kilo", url: "https://kilo.ai/models" },
};

const modelSources: Readonly<Record<string, { name: string; url: string }>> = {
  opencode: { name: "OpenCode", url: "https://opencode.ai/docs/console/models/" },
  "ovh-free": { name: "OVHcloud", url: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/" },
  "ollama-local": { name: "Ollama", url: "https://ollama.com/library" },
};
const webSites: Readonly<Record<string, { manufacturer: string; name: string; url: string }>> = {
  chatgpt: { manufacturer: "OpenAI", name: "ChatGPT", url: "https://chatgpt.com/" },
  gemini: { manufacturer: "Google", name: "Gemini", url: "https://gemini.google.com/app" },
  qwen: { manufacturer: "Alibaba", name: "Qwen", url: "https://chat.qwen.ai/" },
  deepseek: { manufacturer: "DeepSeek", name: "DeepSeek", url: "https://chat.deepseek.com/" },
  glm: { manufacturer: "Z.ai", name: "Z.ai", url: "https://chat.z.ai/" },
  grok: { manufacturer: "xAI", name: "Grok", url: "https://grok.com/" },
};

const manufacturers: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:openai|gpt|o[134])(?:[-_/]|$)/i, "OpenAI"],
  [/^(?:anthropic|claude)(?:[-_/]|$)/i, "Anthropic"],
  [/^(?:google|gemini|gemma)(?:[-_.:/\d]|$)/i, "Google"],
  [/^(?:z-ai|glm)(?:[-_./\d]|$)/i, "Z.ai"],
  [/^(?:alibaba|qwen)(?:[-_.:/\d]|$)/i, "Alibaba"],
  [/^(?:mistralai|mistral)(?:[-_./]|$)/i, "Mistral AI"],
  [/^(?:meta-llama|meta|llama)(?:[-_./\d]|$)/i, "Meta"],
  [/^(?:deepseek)(?:[-_./]|$)/i, "DeepSeek"],
  [/^(?:minimax)(?:[-_./]|$)/i, "MiniMax"],
  [/^(?:moonshotai|kimi)(?:[-_./]|$)/i, "Moonshot AI"],
  [/^(?:ibm|granite)(?:[-_./]|$)/i, "IBM"],
  [/^(?:nvidia|nemotron)(?:[-_./]|$)/i, "NVIDIA"],
  [/^(?:xiaomi|mimo)(?:[-_./]|$)/i, "Xiaomi"],
  [/^(?:baidu|ernie)(?:[-_./]|$)/i, "Baidu"],
  [/^(?:cohere|command)(?:[-_./]|$)/i, "Cohere"],
  [/^(?:liquid|lfm)(?:[-_./]|$)/i, "Liquid AI"],
  [/^(?:x-ai|xai|grok)(?:[-_./]|$)/i, "xAI"],
];

export const MANUFACTURER_PROFILE_ID = "mt-manufacturers";
const nativeSources: Readonly<Record<string, { name: string; url: string }>> = {
  codex: { name: "Codex", url: "https://chatgpt.com/codex" },
  claudeAgent: { name: "Claude", url: "https://claude.ai/" },
  antigravity: { name: "Antigravity", url: "https://antigravity.google/" },
  grok: { name: "Grok", url: "https://grok.com/" },
};

export function modelCatalogBrand(instanceId: string, slug: string, driverKind?: string) {
  if (slug.startsWith("mt-auto")) return undefined;
  if (instanceId === "web-ai") {
    const site = webSites[slug];
    return site ? { supplier: site, manufacturer: site.manufacturer } : undefined;
  }
  const [prefix = "", ...path] = slug.split("/");
  const supplier =
    gatewaySources[instanceId] ??
    (instanceId === "opencode-free" ? modelSources[prefix] : undefined) ??
    nativeSources[driverKind ?? ""];
  if (!supplier) return undefined;
  const manufacturer =
    (path.length ? path : [slug])
      .map((segment) => manufacturers.find(([pattern]) => pattern.test(segment))?.[1])
      .find((name) => name !== undefined) ??
    (driverKind === "codex" ? "OpenAI" : driverKind === "claudeAgent" ? "Anthropic" : undefined);
  return { supplier, manufacturer };
}
