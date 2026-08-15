/**
 * OpenTray identity form. Auto-derived defaults live in placeholders; an
 * empty input means "use the default" and confirmation resolves them.
 */
import { ImagePlus } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WizardFormDefaults, WizardFormValues } from "@/wizard-protocol";

interface AppFormProps {
  values: WizardFormValues;
  defaults: WizardFormDefaults;
  frozen: boolean;
  hasScrapedIcon: boolean;
  onPatch(patch: Partial<WizardFormValues>): void;
}

export function AppForm({
  values,
  defaults,
  frozen,
  hasScrapedIcon,
  onPatch,
}: AppFormProps): React.JSX.Element {
  const disabled = frozen;
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
      <div>
        <Label htmlFor="appId">App ID</Label>
        <Input
          id="appId"
          className="mt-1 font-mono"
          disabled={disabled}
          value={values.appId}
          placeholder={defaults.appId || "由命令推导（如 start.somecommand.npx）"}
          onChange={(event) => onPatch({ appId: event.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="appName">应用名称</Label>
        <Input
          id="appName"
          className="mt-1"
          disabled={disabled}
          value={values.appName}
          placeholder={defaults.appName || "从服务页面标题抓取"}
          onChange={(event) => onPatch({ appName: event.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="iconPath" className="flex items-center gap-1">
          <ImagePlus className="size-3" />
          应用图标
        </Label>
        <Input
          id="iconPath"
          className="mt-1 font-mono"
          disabled={disabled}
          value={values.iconPath}
          placeholder={
            hasScrapedIcon
              ? "留空使用抓取到的 favicon；或输入本地图片路径覆盖"
              : "未抓取到图标，将使用首字母图标；或输入本地图片路径"
          }
          onChange={(event) => onPatch({ iconPath: event.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="servicePort">服务端口</Label>
        <Input
          id="servicePort"
          className="mt-1 font-mono"
          inputMode="numeric"
          disabled={disabled}
          value={values.servicePort}
          placeholder="运行命令后自动嗅探；或手动填写"
          onChange={(event) => onPatch({ servicePort: event.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="pm">包管理器</Label>
        <Select
          value={values.pm}
          disabled={disabled}
          onValueChange={(pm) =>
            onPatch({ pm: pm as WizardFormValues["pm"] })
          }
        >
          <SelectTrigger id="pm" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="npm">npm</SelectItem>
            <SelectItem value="pnpm">pnpm</SelectItem>
            <SelectItem value="bun">bun</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="targetDir">目标目录</Label>
        <Input
          id="targetDir"
          className="mt-1 font-mono"
          disabled={disabled}
          value={values.targetDir}
          placeholder={defaults.targetDir || "当前目录下按 App ID 命名"}
          onChange={(event) => onPatch({ targetDir: event.target.value })}
        />
      </div>
    </div>
  );
}
