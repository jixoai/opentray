// 官方生态品牌标（add-create-command-family D5）：simple-icons v13 官方单色
// SVG（CC0），vendor 于 icons/，去 title 后内联渲染并跟随 currentColor，
// 明暗主题安全。自定义系列无官方品牌，用 lucide Pencil（用户指定的 edit 图标）。
import { Pencil } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import type { Family } from "@/lib/command-family";
import dotnetSvg from "./icons/dotnet.svg?raw";
import goSvg from "./icons/go.svg?raw";
import npmSvg from "./icons/npm.svg?raw";
import pythonSvg from "./icons/python.svg?raw";
import rustSvg from "./icons/rust.svg?raw";

const brandIcon = (svg: string): React.ComponentType<{ className?: string }> => {
  const markup = svg.replace(/<title>[\s\S]*?<\/title>/g, "");
  const Icon = ({ className }: { className?: string }): React.JSX.Element => (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 [&_svg]:size-full [&_svg]:fill-current",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
  return Icon;
};

export const FAMILY_ICON: Record<Family, React.ComponentType<{ className?: string }>> = {
  npm: brandIcon(npmSvg),
  go: brandIcon(goSvg),
  rust: brandIcon(rustSvg),
  python: brandIcon(pythonSvg),
  dotnet: brandIcon(dotnetSvg),
  custom: Pencil,
};
