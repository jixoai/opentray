// Locale catalogs and locale/direction utilities (openspec change
// redesign-create-opentray-webui).
//
// Nine language families: zh-CN, ja, ko, en, ar, fr, es, de, ru. Initial
// locale follows a persisted explicit choice, else the closest supported
// system locale, else English. Arabic sets document direction RTL;
// technical islands stay explicitly LTR through .tech-ltr.

export const LOCALES = ["zh-CN", "ja", "ko", "en", "ar", "fr", "es", "de", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

export const RTL_LOCALES: readonly Locale[] = ["ar"];

export const localeDirection = (locale: Locale): "ltr" | "rtl" =>
  RTL_LOCALES.includes(locale) ? "rtl" : "ltr";

export const localeLabel = (locale: Locale): string => {
  const labels: Record<Locale, string> = {
    "zh-CN": "简体中文",
    ja: "日本語",
    ko: "한국어",
    en: "English",
    ar: "العربية",
    fr: "Français",
    es: "Español",
    de: "Deutsch",
    ru: "Русский",
  };
  return labels[locale];
};

/** Map a system locale string to the closest supported catalog. */
export const resolveSystemLocale = (system: readonly string[]): Locale => {
  for (const candidate of system) {
    const lower = candidate.toLowerCase();
    const exact = LOCALES.find((locale) => locale.toLowerCase() === lower);
    if (exact !== undefined) return exact;
    const base = lower.split("-")[0]!;
    const prefix = LOCALES.find((locale) => locale.toLowerCase().split("-")[0] === base);
    if (prefix !== undefined) return prefix;
    // zh-TW/zh-HK still map to the zh-CN catalog (closest supported family).
    if (base === "zh") return "zh-CN";
  }
  return "en";
};

export interface Messages {
  readonly nav: { readonly add: string; readonly applications: string; readonly help: string };
  readonly shell: { readonly product: string; readonly toggleSidebar: string };
  readonly common: {
    readonly loading: string;
    readonly error: string;
    readonly retry: string;
    readonly cancel: string;
    readonly confirm: string;
    readonly close: string;
    readonly copy: string;
    readonly copied: string;
    readonly download: string;
    readonly refresh: string;
    readonly empty: string;
  };
  readonly theme: {
    readonly title: string;
    readonly system: string;
    readonly light: string;
    readonly dark: string;
  };
  readonly language: { readonly title: string };
  readonly applications: {
    readonly title: string;
    readonly statusHealthy: string;
    readonly statusInvalidConfig: string;
    readonly statusIncompatible: string;
    readonly statusMissingPayload: string;
    readonly statusBrokenLink: string;
    readonly statusRunning: string;
    readonly edit: string;
    readonly open: string;
    readonly share: string;
    readonly details: string;
    readonly source: string;
    readonly sourceWizard: string;
    readonly sourceRegistered: string;
    readonly detailsCommand: string;
    readonly detailsCwd: string;
    readonly detailsEnv: string;
    readonly detailsPm: string;
    readonly detailsWindow: string;
    readonly detailsDevMode: string;
    readonly detailsProjectDir: string;
    readonly detailsServiceHint: string;
    readonly uninstall: string;
    readonly uninstallTitle: string;
    readonly uninstallDescription: string;
    readonly uninstallWizardDescription: string;
    readonly stopRunningTitle: string;
    readonly stopRunningDescription: string;
    readonly stopRunningConfirm: string;
    readonly stopRunningPids: string;
    readonly uninstallPurge: string;
    readonly uninstallPurgeHint: string;
    readonly uninstallPinHint: string;
    readonly emptyHint: string;
    readonly payload: string;
    readonly registration: string;
    readonly linked: string;
    readonly uninstallRetained: string;
    readonly uninstallDeleted: string;
  };
  readonly help: {
    readonly title: string;
    readonly listTitle: string;
    readonly empty: string;
    readonly readError: string;
  };
  readonly export: {
    readonly title: string;
    readonly shareTitle: string;
    readonly shareSubtitle: string;
    readonly command: string;
    readonly scriptSh: string;
    readonly scriptPs1: string;
    readonly copyCommand: string;
    readonly downloadScript: string;
    readonly downloadFile: string;
    readonly viewFull: string;
    readonly building: string;
    readonly inlineIcon: string;
    readonly inlineIconHint: string;
    readonly forceCopy: string;
    readonly forceCopyHint: string;
    readonly envAck: string;
    readonly envAckHint: string;
    readonly envReview: string;
    readonly blocked: string;
  };
}

// English is the base catalog; other locales override it key-by-key so a
// missing translation falls back rather than rendering an empty string.
const en: Messages = {
  nav: { add: "Add", applications: "Applications", help: "Help Center" },
  shell: { product: "create-opentray", toggleSidebar: "Toggle Sidebar" },
  common: {
    loading: "Loading…",
    error: "Something went wrong.",
    retry: "Retry",
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    copy: "Copy",
    copied: "Copied",
    download: "Download",
    refresh: "Refresh",
    empty: "Nothing here yet.",
  },
  theme: { title: "Theme", system: "System", light: "Light", dark: "Dark" },
  language: { title: "Language" },
  applications: {
    title: "Applications",
    statusHealthy: "Healthy",
    statusInvalidConfig: "Invalid config",
    statusIncompatible: "Incompatible version",
    statusMissingPayload: "Missing payload",
    statusBrokenLink: "Broken link",
    statusRunning: "Running",
    edit: "Edit",
    open: "Open",
    share: "Share",
    details: "Details",
    source: "Source",
    sourceWizard: "Wizard",
    sourceRegistered: "Registered",
    detailsCommand: "Command",
    detailsCwd: "Working directory",
    detailsEnv: "Environment keys",
    detailsPm: "Package manager",
    detailsWindow: "Window",
    detailsDevMode: "Developer mode",
    detailsProjectDir: "Project directory",
    detailsServiceHint: "Service port hint",
    uninstall: "Uninstall",
    uninstallTitle: "Uninstall application?",
    uninstallDescription:
      "The registration and its payload link are removed. Dock/taskbar pins must be removed manually.",
    uninstallWizardDescription:
      "The wizard project directory and its materialized app bundle are removed after stopping a running entry when authorized. Dock/taskbar pins must be removed manually.",
    stopRunningTitle: "Force stop and uninstall?",
    stopRunningDescription:
      "The application is still running (likely a leftover from an earlier session). Continuing terminates its process tree first, then removes the project.",
    stopRunningConfirm: "Force stop and uninstall",
    stopRunningPids: "Running pids",
    uninstallPurge: "Also delete the linked external target",
    uninstallPurgeHint:
      "Deletes the external directory itself after identity revalidation. This cannot be undone.",
    uninstallPinHint:
      "macOS Dock pins and Windows taskbar pins are user-managed; remove them manually if present.",
    emptyHint: "No applications yet — create one from Add.",
    payload: "Payload",
    registration: "Registration",
    linked: "Linked",
    uninstallRetained: "External target retained:",
    uninstallDeleted: "External target deleted:",
  },
  help: {
    title: "Help Center",
    listTitle: "Documents",
    empty: "No documents available.",
    readError: "This document could not be read.",
  },
  export: {
    title: "Export",
    shareTitle: "Share application",
    shareSubtitle: "Built from the current wizard parameters — nothing runs, nothing is written.",
    command: "Direct command",
    scriptSh: "Shell script (.sh)",
    scriptPs1: "PowerShell script (.ps1)",
    copyCommand: "Copy command",
    downloadScript: "Download script",
    downloadFile: "Download file",
    viewFull: "View full content",
    building: "Building…",
    inlineIcon: "Inline icon bytes",
    inlineIconHint:
      "Web-scraped icons share as their original URL by default and local icons embed their bytes; toggle to switch between embedding and sharing by reference.",
    forceCopy: "Force direct copy with embedded icon",
    forceCopyHint:
      "Uploaded icons embed as very long data URLs. Scripts are the default; check this only if you accept the length.",
    envAck: "I reviewed the environment values and accept exporting them",
    envAckHint:
      "This application defines environment entries. Complete export includes their values.",
    envReview: "Environment values (editable before export)",
    blocked: "Export blocked:",
  },
};

const deepMerge = (base: Messages, override: DeepPartial<Messages>): Messages => {
  const merge = (b: unknown, o: unknown): unknown => {
    if (typeof b === "object" && b !== null && !Array.isArray(b) && typeof o === "object" && o !== null) {
      const out: Record<string, unknown> = { ...(b as Record<string, unknown>) };
      for (const [key, value] of Object.entries(o as Record<string, unknown>)) {
        if (value !== undefined) {
          out[key] = merge((b as Record<string, unknown>)[key], value);
        }
      }
      return out;
    }
    return o === undefined ? b : o;
  };
  return merge(base, override) as Messages;
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const zhCN: DeepPartial<Messages> = {
  shell: { product: "create-opentray", toggleSidebar: "切换侧边栏" },
  nav: { add: "新增", applications: "应用列表", help: "帮助中心" },
  common: {
    loading: "加载中…", error: "出错了。", retry: "重试", cancel: "取消", confirm: "确认",
    close: "关闭", copy: "复制", copied: "已复制", download: "下载", refresh: "刷新", empty: "暂无内容。",
  },
  theme: { title: "主题", system: "跟随系统", light: "浅色", dark: "深色" },
  language: { title: "语言" },
  applications: {
    title: "应用列表",
    statusHealthy: "正常", statusInvalidConfig: "配置无效", statusIncompatible: "版本不兼容",
    statusMissingPayload: "负载缺失", statusBrokenLink: "链接失效", statusRunning: "运行中",
    edit: "编辑", open: "打开应用", share: "分享", details: "详情",
    source: "来源", sourceWizard: "向导", sourceRegistered: "注册",
    detailsCommand: "命令", detailsCwd: "工作目录", detailsEnv: "环境变量键",
    detailsPm: "包管理器", detailsWindow: "窗口", detailsDevMode: "开发者模式",
    detailsProjectDir: "项目目录", detailsServiceHint: "服务端口提示",
    uninstall: "卸载",
    uninstallTitle: "卸载应用？",
    uninstallDescription: "将删除注册信息与负载链接。Dock/任务栏图标需手动移除。",
    uninstallWizardDescription: "将停止运行中的应用（如已授权）并删除项目目录与已物化的应用 Bundle。Dock/任务栏图标需手动移除。",
    stopRunningTitle: "强制停止并卸载？",
    stopRunningDescription: "应用仍在运行（可能是上次会话的残留）。继续将先终止其进程树，再删除项目目录与已物化的 Bundle。",
    stopRunningConfirm: "强制停止并卸载",
    stopRunningPids: "运行中的进程",
    uninstallPurge: "同时删除链接的外部目录",
    uninstallPurgeHint: "重新校验身份后删除外部目录本身，此操作不可撤销。",
    uninstallPinHint: "macOS Dock 与 Windows 任务栏图标由系统管理，请手动移除。",
    emptyHint: "还没有应用——去「新增」创建一个。",
    payload: "负载", registration: "注册", linked: "链接",
    uninstallRetained: "外部目录已保留：", uninstallDeleted: "外部目录已删除：",
  },
  help: { title: "帮助中心", listTitle: "文档", empty: "暂无文档。", readError: "无法读取该文档。" },
  export: {
    title: "导出",
    shareTitle: "分享应用",
    shareSubtitle: "基于当前向导参数构建——不运行命令、不写入任何内容。",
    command: "直接命令", scriptSh: "Shell 脚本（.sh）", scriptPs1: "PowerShell 脚本（.ps1）",
    copyCommand: "复制命令", downloadScript: "下载脚本", downloadFile: "下载文件",
    viewFull: "查看完整内容", building: "生成中…",
    inlineIcon: "内联图标字节",
    inlineIconHint: "网页抓取的图标默认以原始链接分享、本地图标默认内嵌字节；勾选状态即在内嵌与按引用分享之间切换。",
    forceCopy: "强制直接复制（内嵌图标）",
    forceCopyHint: "上传的图标会以很长的 data URL 内嵌，默认导出脚本；仅在你接受长度时勾选。",
    envAck: "我已检查环境变量并接受导出",
    envAckHint: "该应用定义了环境变量，完整导出将包含其值。",
    envReview: "环境变量（导出前可编辑）",
    blocked: "导出被阻止：",
  },
};

const ja: DeepPartial<Messages> = {
  shell: { product: "create-opentray", toggleSidebar: "サイドバー切替" },
  nav: { add: "追加", applications: "アプリ一覧", help: "ヘルプセンター" },
  common: {
    loading: "読み込み中…", error: "エラーが発生しました。", retry: "再試行", cancel: "キャンセル",
    confirm: "確認", close: "閉じる", copy: "コピー", copied: "コピーしました", download: "ダウンロード",
    refresh: "更新", empty: "まだ何もありません。",
  },
  theme: { title: "テーマ", system: "システム", light: "ライト", dark: "ダーク" },
  language: { title: "言語" },
  applications: {
    title: "アプリ一覧",
    statusHealthy: "正常", statusInvalidConfig: "設定が無効", statusIncompatible: "バージョン非対応",
    statusMissingPayload: "ペイロード欠落", statusBrokenLink: "リンク切れ", statusRunning: "実行中",
    edit: "編集", uninstall: "アンインストール",
    uninstallTitle: "アプリをアンインストールしますか？",
    uninstallDescription: "登録とペイロードリンクを削除します。Dock/タスクバーのピンは手動で外してください。",
    uninstallPurge: "リンク先の外部ディレクトリも削除する",
    uninstallPurgeHint: "身份を再検証した上で外部ディレクトリ自体を削除します。元に戻せません。",
    uninstallPinHint: "macOS の Dock ピンと Windows のタスクバーピンは手動で管理してください。",
    emptyHint: "登録済みアプリはまだありません。「追加」から作成してください。",
    payload: "ペイロード", registration: "登録", linked: "リンク",
    uninstallRetained: "外部ディレクトリは保持されました：", uninstallDeleted: "外部ディレクトリを削除しました：",
  },
  help: { title: "ヘルプセンター", listTitle: "ドキュメント", empty: "ドキュメントはありません。", readError: "このドキュメントは読み込めませんでした。" },
  export: {
    title: "エクスポート",
    command: "直接コマンド", scriptSh: "Shell スクリプト（.sh）", scriptPs1: "PowerShell スクリプト（.ps1）",
    copyCommand: "コマンドをコピー", downloadScript: "スクリプトをダウンロード",
    forceCopy: "アイコン埋め込みの直接コピーを強制する",
    forceCopyHint: "アップロードしたアイコンは非常に長い data URL として埋め込まれます。既定はスクリプトです。",
    envAck: "環境変数を確認し、エクスポートを許可します",
    envAckHint: "このアプリには環境変数が定義されており、完全なエクスポートに値が含まれます。",
    envReview: "環境変数（エクスポート前に編集可）",
    blocked: "エクスポートをブロック：",
  },
};

const ko: DeepPartial<Messages> = {
  shell: { product: "create-opentray", toggleSidebar: "사이드바 전환" },
  nav: { add: "추가", applications: "앱 목록", help: "도움말 센터" },
  common: {
    loading: "불러오는 중…", error: "문제가 발생했습니다.", retry: "재시도", cancel: "취소",
    confirm: "확인", close: "닫기", copy: "복사", copied: "복사됨", download: "다운로드", refresh: "새로고침",
    empty: "아직 없습니다.",
  },
  theme: { title: "테마", system: "시스템", light: "라이트", dark: "다크" },
  language: { title: "언어" },
  applications: {
    title: "앱 목록",
    statusHealthy: "정상", statusInvalidConfig: "구성 무효", statusIncompatible: "버전 비호환",
    statusMissingPayload: "페이로드 누락", statusBrokenLink: "링크 끊김", statusRunning: "실행 중",
    edit: "편집", uninstall: "제거",
    uninstallTitle: "앱을 제거할까요?",
    uninstallDescription: "등록 정보와 페이로드 링크가 삭제됩니다. Dock/작업표시줄 고정은 직접 해제하세요.",
    uninstallPurge: "연결된 외부 디렉터리도 삭제",
    uninstallPurgeHint: "신원 재검증 후 외부 디렉터리 자체를 삭제합니다. 되돌릴 수 없습니다.",
    uninstallPinHint: "macOS Dock 고정과 Windows 작업표시줄 고정은 직접 관리해야 합니다.",
    emptyHint: "등록된 앱이 아직 없습니다. 「추가」에서 만들어 보세요.",
    payload: "페이로드", registration: "등록", linked: "링크",
    uninstallRetained: "외부 디렉터리 유지됨:", uninstallDeleted: "외부 디렉터리 삭제됨:",
  },
  help: { title: "도움말 센터", listTitle: "문서", empty: "문서가 없습니다.", readError: "이 문서를 읽을 수 없습니다." },
  export: {
    title: "내보내기",
    command: "직접 명령", scriptSh: "Shell 스크립트(.sh)", scriptPs1: "PowerShell 스크립트(.ps1)",
    copyCommand: "명령 복사", downloadScript: "스크립트 다운로드",
    forceCopy: "아이콘 포함 직접 복사 강제",
    forceCopyHint: "업로드한 아이콘은 매우 긴 data URL로 포함됩니다. 기본은 스크립트입니다.",
    envAck: "환경 변수를 확인했으며 내보내기를 허용합니다",
    envAckHint: "이 앱에는 환경 변수가 정의되어 있어 전체 내보내기에 값이 포함됩니다.",
    envReview: "환경 변수(내보내기 전 편집 가능)",
    blocked: "내보내기 차단:",
  },
};

const ar: DeepPartial<Messages> = {
  shell: { product: "create-opentray", toggleSidebar: "تبديل الشريط الجانبي" },
  nav: { add: "إضافة", applications: "التطبيقات", help: "مركز المساعدة" },
  common: {
    loading: "جارٍ التحميل…", error: "حدث خطأ.", retry: "إعادة المحاولة", cancel: "إلغاء",
    confirm: "تأكيد", close: "إغلاق", copy: "نسخ", copied: "تم النسخ", download: "تنزيل", refresh: "تحديث",
    empty: "لا يوجد شيء بعد.",
  },
  theme: { title: "المظهر", system: "النظام", light: "فاتح", dark: "داكن" },
  language: { title: "اللغة" },
  applications: {
    title: "التطبيقات",
    statusHealthy: "سليم", statusInvalidConfig: "تهيئة غير صالحة", statusIncompatible: "إصدار غير متوافق",
    statusMissingPayload: "الحِمل مفقود", statusBrokenLink: "رابط معطّل", statusRunning: "قيد التشغيل",
    edit: "تحرير", uninstall: "إزالة",
    uninstallTitle: "إزالة التطبيق؟",
    uninstallDescription: "سيُحذف التسجيل ورابط الحِمل. يجب إزالة تثبيت Dock/شريط المهام يدويًا.",
    uninstallPurge: "حذف الدليل الخارجي المرتبط أيضًا",
    uninstallPurgeHint: "يحذف الدليل الخارجي نفسه بعد إعادة التحقق من الهوية. لا يمكن التراجع.",
    uninstallPinHint: "تثبيتات Dock في macOS وشريط المهام في Windows يديرها المستخدم؛ أزلها يدويًا.",
    emptyHint: "لا توجد تطبيقات مسجلة بعد — أنشئ واحدًا من «إضافة».",
    payload: "الحِمل", registration: "التسجيل", linked: "مرتبط",
    uninstallRetained: "احتُفظ بالدليل الخارجي:", uninstallDeleted: "حُذف الدليل الخارجي:",
  },
  help: { title: "مركز المساعدة", listTitle: "المستندات", empty: "لا توجد مستندات.", readError: "تعذّرت قراءة هذا المستند." },
  export: {
    title: "تصدير",
    command: "أمر مباشر", scriptSh: "سكربت Shell‏ (.sh)", scriptPs1: "سكربت PowerShell‏ (.ps1)",
    copyCommand: "نسخ الأمر", downloadScript: "تنزيل السكربت",
    forceCopy: "فرض النسخ المباشر مع تضمين الأيقونة",
    forceCopyHint: "تُضمَّن الأيقونات المرفوعة كعناوين data URL طويلة جدًا؛ السكربت هو الافتراضي.",
    envAck: "راجعت متغيرات البيئة وأوافق على تصديرها",
    envAckHint: "يحدّد هذا التطبيق متغيرات بيئة، وسيشمل التصدير الكامل قيمها.",
    envReview: "متغيرات البيئة (قابلة للتحرير قبل التصدير)",
    blocked: "التصدير محجوب:",
  },
};

const fr: DeepPartial<Messages> = {
  shell: { product: "create-opentray", toggleSidebar: "Basculer la barre latérale" },
  nav: { add: "Ajouter", applications: "Applications", help: "Centre d'aide" },
  common: {
    loading: "Chargement…", error: "Une erreur est survenue.", retry: "Réessayer", cancel: "Annuler",
    confirm: "Confirmer", close: "Fermer", copy: "Copier", copied: "Copié", download: "Télécharger",
    refresh: "Actualiser", empty: "Rien pour le moment.",
  },
  theme: { title: "Thème", system: "Système", light: "Clair", dark: "Sombre" },
  language: { title: "Langue" },
  applications: {
    title: "Applications",
    statusHealthy: "Sain", statusInvalidConfig: "Config invalide", statusIncompatible: "Version incompatible",
    statusMissingPayload: "Charge utile manquante", statusBrokenLink: "Lien rompu", statusRunning: "En cours",
    edit: "Modifier", uninstall: "Désinstaller",
    uninstallTitle: "Désinstaller l'application ?",
    uninstallDescription: "L'enregistrement et le lien de charge utile sont supprimés. Les épingles Dock/barre des tâches se retirent manuellement.",
    uninstallPurge: "Supprimer aussi le répertoire externe lié",
    uninstallPurgeHint: "Supprime le répertoire externe lui-même après revalidation de l'identité. Irréversible.",
    uninstallPinHint: "Les épingles Dock (macOS) et barre des tâches (Windows) sont gérées par l'utilisateur.",
    emptyHint: "Aucune application enregistrée — créez-en une depuis Ajouter.",
    payload: "Charge utile", registration: "Enregistrement", linked: "Lié",
    uninstallRetained: "Répertoire externe conservé :", uninstallDeleted: "Répertoire externe supprimé :",
  },
  help: { title: "Centre d'aide", listTitle: "Documents", empty: "Aucun document.", readError: "Impossible de lire ce document." },
  export: {
    title: "Exporter",
    command: "Commande directe", scriptSh: "Script shell (.sh)", scriptPs1: "Script PowerShell (.ps1)",
    copyCommand: "Copier la commande", downloadScript: "Télécharger le script",
    forceCopy: "Forcer la copie directe avec icône intégrée",
    forceCopyHint: "Les icônes téléversées sont incorporées en data URLs très longues ; le script est la valeur par défaut.",
    envAck: "J'ai revu les variables d'environnement et accepte de les exporter",
    envAckHint: "Cette application définit des variables d'environnement ; l'export complet inclut leurs valeurs.",
    envReview: "Variables d'environnement (modifiables avant export)",
    blocked: "Export bloqué :",
  },
};

const es: DeepPartial<Messages> = {
  shell: { product: "create-opentray", toggleSidebar: "Alternar barra lateral" },
  nav: { add: "Añadir", applications: "Aplicaciones", help: "Centro de ayuda" },
  common: {
    loading: "Cargando…", error: "Algo salió mal.", retry: "Reintentar", cancel: "Cancelar",
    confirm: "Confirmar", close: "Cerrar", copy: "Copiar", copied: "Copiado", download: "Descargar",
    refresh: "Actualizar", empty: "Aún no hay nada.",
  },
  theme: { title: "Tema", system: "Sistema", light: "Claro", dark: "Oscuro" },
  language: { title: "Idioma" },
  applications: {
    title: "Aplicaciones",
    statusHealthy: "Sano", statusInvalidConfig: "Config no válida", statusIncompatible: "Versión incompatible",
    statusMissingPayload: "Carga útil ausente", statusBrokenLink: "Enlace roto", statusRunning: "En ejecución",
    edit: "Editar", uninstall: "Desinstalar",
    uninstallTitle: "¿Desinstalar la aplicación?",
    uninstallDescription: "Se eliminan el registro y el enlace de carga útil. Los anclajes del Dock/barra de tareas se quitan manualmente.",
    uninstallPurge: "Eliminar también el directorio externo enlazado",
    uninstallPurgeHint: "Elimina el directorio externo tras revalidar la identidad. No se puede deshacer.",
    uninstallPinHint: "Los anclajes del Dock (macOS) y de la barra de tareas (Windows) los gestiona el usuario.",
    emptyHint: "Aún no hay aplicaciones registradas: crea una desde Añadir.",
    payload: "Carga útil", registration: "Registro", linked: "Enlazado",
    uninstallRetained: "Directorio externo conservado:", uninstallDeleted: "Directorio externo eliminado:",
  },
  help: { title: "Centro de ayuda", listTitle: "Documentos", empty: "No hay documentos.", readError: "No se pudo leer este documento." },
  export: {
    title: "Exportar",
    command: "Comando directo", scriptSh: "Script de shell (.sh)", scriptPs1: "Script de PowerShell (.ps1)",
    copyCommand: "Copiar comando", downloadScript: "Descargar script",
    forceCopy: "Forzar copia directa con icono incrustado",
    forceCopyHint: "Los iconos subidos se incrustan como data URLs muy largas; el script es la opción predeterminada.",
    envAck: "He revisado las variables de entorno y acepto exportarlas",
    envAckHint: "Esta aplicación define variables de entorno; la exportación completa incluye sus valores.",
    envReview: "Variables de entorno (editables antes de exportar)",
    blocked: "Exportación bloqueada:",
  },
};

const de: DeepPartial<Messages> = {
  shell: { product: "create-opentray", toggleSidebar: "Seitenleiste umschalten" },
  nav: { add: "Hinzufügen", applications: "Anwendungen", help: "Hilfecenter" },
  common: {
    loading: "Lädt…", error: "Etwas ist schiefgelaufen.", retry: "Erneut versuchen", cancel: "Abbrechen",
    confirm: "Bestätigen", close: "Schließen", copy: "Kopieren", copied: "Kopiert", download: "Herunterladen",
    refresh: "Aktualisieren", empty: "Noch nichts vorhanden.",
  },
  theme: { title: "Design", system: "System", light: "Hell", dark: "Dunkel" },
  language: { title: "Sprache" },
  applications: {
    title: "Anwendungen",
    statusHealthy: "Intakt", statusInvalidConfig: "Ungültige Konfiguration", statusIncompatible: "Inkompatible Version",
    statusMissingPayload: "Payload fehlt", statusBrokenLink: "Defekter Link", statusRunning: "Läuft",
    edit: "Bearbeiten", uninstall: "Deinstallieren",
    uninstallTitle: "Anwendung deinstallieren?",
    uninstallDescription: "Registrierung und Payload-Link werden entfernt. Dock-/Taskleisten-Anker bitte manuell entfernen.",
    uninstallPurge: "Verknüpftes externes Verzeichnis ebenfalls löschen",
    uninstallPurgeHint: "Löscht das externe Verzeichnis nach Identitätsprüfung. Nicht rückgängig machbar.",
    uninstallPinHint: "Dock-Anker (macOS) und Taskleisten-Anker (Windows) verwaltet der Benutzer manuell.",
    emptyHint: "Noch keine registrierten Anwendungen — erstelle eine unter „Hinzufügen“.",
    payload: "Payload", registration: "Registrierung", linked: "Verknüpft",
    uninstallRetained: "Externes Verzeichnis behalten:", uninstallDeleted: "Externes Verzeichnis gelöscht:",
  },
  help: { title: "Hilfecenter", listTitle: "Dokumente", empty: "Keine Dokumente.", readError: "Dieses Dokument konnte nicht gelesen werden." },
  export: {
    title: "Exportieren",
    command: "Direktbefehl", scriptSh: "Shell-Skript (.sh)", scriptPs1: "PowerShell-Skript (.ps1)",
    copyCommand: "Befehl kopieren", downloadScript: "Skript herunterladen",
    forceCopy: "Direktes Kopieren mit eingebettetem Symbol erzwingen",
    forceCopyHint: "Hochgeladene Symbole werden als sehr lange Data-URLs eingebettet; Standard ist das Skript.",
    envAck: "Ich habe die Umgebungsvariablen geprüft und akzeptiere ihren Export",
    envAckHint: "Diese Anwendung definiert Umgebungsvariablen; der vollständige Export enthält deren Werte.",
    envReview: "Umgebungsvariablen (vor dem Export bearbeitbar)",
    blocked: "Export blockiert:",
  },
};

const ru: DeepPartial<Messages> = {
  shell: { product: "create-opentray", toggleSidebar: "Показать/скрыть боковую панель" },
  nav: { add: "Добавить", applications: "Приложения", help: "Центр справки" },
  common: {
    loading: "Загрузка…", error: "Что-то пошло не так.", retry: "Повторить", cancel: "Отмена",
    confirm: "Подтвердить", close: "Закрыть", copy: "Копировать", copied: "Скопировано", download: "Скачать",
    refresh: "Обновить", empty: "Пока ничего нет.",
  },
  theme: { title: "Тема", system: "Системная", light: "Светлая", dark: "Тёмная" },
  language: { title: "Язык" },
  applications: {
    title: "Приложения",
    statusHealthy: "Исправно", statusInvalidConfig: "Неверная конфигурация", statusIncompatible: "Несовместимая версия",
    statusMissingPayload: "Отсутствует payload", statusBrokenLink: "Битая ссылка", statusRunning: "Выполняется",
    edit: "Изменить", uninstall: "Удалить",
    uninstallTitle: "Удалить приложение?",
    uninstallDescription: "Регистрация и ссылка payload будут удалены. Значки Dock/панели задач удаляйте вручную.",
    uninstallPurge: "Также удалить связанный внешний каталог",
    uninstallPurgeHint: "Удаляет внешний каталог после повторной проверки идентичности. Отменить нельзя.",
    uninstallPinHint: "Значки Dock (macOS) и панели задач (Windows) управляются пользователем вручную.",
    emptyHint: "Зарегистрированных приложений пока нет — создайте первое в разделе «Добавить».",
    payload: "Payload", registration: "Регистрация", linked: "Ссылка",
    uninstallRetained: "Внешний каталог сохранён:", uninstallDeleted: "Внешний каталог удалён:",
  },
  help: { title: "Центр справки", listTitle: "Документы", empty: "Документов нет.", readError: "Не удалось прочитать этот документ." },
  export: {
    title: "Экспорт",
    command: "Прямая команда", scriptSh: "Скрипт shell (.sh)", scriptPs1: "Скрипт PowerShell (.ps1)",
    copyCommand: "Копировать команду", downloadScript: "Скачать скрипт",
    forceCopy: "Принудительное копирование со встроенной иконкой",
    forceCopyHint: "Загруженные иконки встраиваются как очень длинные data-URL; по умолчанию — скрипт.",
    envAck: "Я проверил переменные окружения и согласен на их экспорт",
    envAckHint: "В этом приложении заданы переменные окружения; полный экспорт включает их значения.",
    envReview: "Переменные окружения (можно изменить перед экспортом)",
    blocked: "Экспорт заблокирован:",
  },
};

const CATALOGS: Record<Locale, Messages> = {
  en,
  "zh-CN": deepMerge(en, zhCN),
  ja: deepMerge(en, ja),
  ko: deepMerge(en, ko),
  ar: deepMerge(en, ar),
  fr: deepMerge(en, fr),
  es: deepMerge(en, es),
  de: deepMerge(en, de),
  ru: deepMerge(en, ru),
};

export const messagesFor = (locale: Locale): Messages => CATALOGS[locale];

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);
