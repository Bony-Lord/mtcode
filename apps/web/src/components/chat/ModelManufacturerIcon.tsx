import { AnthropicIcon, OpenAI } from "../Icons";
import google from "../../assets/model-logos/gemini-color.svg";
import gemma from "../../assets/model-logos/gemma-color.svg";
import mimo from "../../assets/model-logos/xiaomimimo.svg";
import qwen from "../../assets/model-logos/qwen-color.svg";
import deepseek from "../../assets/model-logos/deepseek-color.svg";
import zai from "../../assets/model-logos/zai.svg";
import mistral from "../../assets/model-logos/mistral-color.svg";
import meta from "../../assets/model-logos/meta-color.svg";
import minimax from "../../assets/model-logos/minimax-color.svg";
import nvidia from "../../assets/model-logos/nvidia-color.svg";
import baidu from "../../assets/model-logos/baidu-color.svg";
import cohere from "../../assets/model-logos/cohere-color.svg";
import liquid from "../../assets/model-logos/liquid.svg";
import grok from "../../assets/model-logos/grok.svg";
import kimi from "../../assets/model-logos/kimi-color.svg";
import ibm from "../../assets/model-logos/ibm.svg";

const logos: Readonly<Record<string, string>> = {
  Google: google,
  Alibaba: qwen,
  DeepSeek: deepseek,
  "Z.ai": zai,
  "Mistral AI": mistral,
  Meta: meta,
  MiniMax: minimax,
  NVIDIA: nvidia,
  Baidu: baidu,
  Cohere: cohere,
  "Liquid AI": liquid,
  xAI: grok,
  Xiaomi: mimo,
  "Moonshot AI": kimi,
  IBM: ibm,
};

export function ModelManufacturerIcon({
  name,
  slug,
}: {
  readonly name: string;
  readonly slug: string;
}) {
  if (name === "OpenAI") return <OpenAI className="size-4 shrink-0" aria-label={name} />;
  if (name === "Anthropic") return <AnthropicIcon className="size-4 shrink-0" aria-label={name} />;
  const src = name === "Google" && /gemma/i.test(slug) ? gemma : logos[name];
  return src ? (
    <img src={src} alt={name} className="size-4 shrink-0 object-contain" />
  ) : (
    <span
      aria-label={name}
      className="grid size-5 shrink-0 place-items-center rounded bg-muted text-3xs font-medium"
    >
      {name.slice(0, 2)}
    </span>
  );
}
