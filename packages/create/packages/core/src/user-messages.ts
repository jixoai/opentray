// Server-side user-facing strings (wizard session emissions), localized for
// the webui's nine locales. The webui reports its locale through the
// `x-opentray-locale` request header and the `/api/events?lang=` parameter;
// the wizard session stores it and every string it emits to the browser goes
// through this catalog. Technical error surfaces (spawn errors, tokenizer
// messages) intentionally stay untranslated.
//
// zh-CN stays the default argument value for direct core consumers (CLI) to
// preserve existing behavior; the wizard server passes its session locale.

export const UI_LOCALES = ["zh-CN", "ja", "ko", "en", "ar", "fr", "es", "de", "ru"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const isUiLocale = (value: string): value is UiLocale =>
  (UI_LOCALES as readonly string[]).includes(value);

/** Resolve a raw header/query value to a catalog locale (case-insensitive). */
export const resolveUiLocale = (raw: string | undefined | null): UiLocale | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const exact = UI_LOCALES.find((locale) => locale.toLowerCase() === raw.toLowerCase());
  if (exact !== undefined) return exact;
  const base = raw.toLowerCase().split("-")[0]!;
  const prefix = UI_LOCALES.find((locale) => locale.toLowerCase().split("-")[0] === base);
  return prefix ?? (base === "zh" ? "zh-CN" : undefined);
};

interface UserMessages {
  readonly pinHintDarwin: string;
  readonly pinHintWindows: string;
  readonly pinHintOther: string;
  readonly ptyBunTerminalMissing: string;
  readonly ptyNodePtyMissing: string;
  /** Appended to the raw materialize error when the target dir is occupied. */
  readonly dirOccupiedSuffix: string;
  readonly urlInvalid: string;
  readonly urlSchemeUnsupported: string;
  readonly argvProgramRequired: string;
}

const en: UserMessages = {
  pinHintDarwin:
    "After opening the app for the first time, right-click its Dock icon and choose “Options → Keep in Dock” to pin it.",
  pinHintWindows:
    "Right-click the app's taskbar icon and choose “Pin to taskbar”. (OpenTray does not generate Start-menu shortcuts yet)",
  pinHintOther:
    "Pin the app window to the taskbar/favorites; Linux desktop shortcut generation is not provided yet.",
  ptyBunTerminalMissing:
    "This Bun build lacks Bun.Terminal (Bun ≥ 1.2.19 required); the preview runs non-interactively.",
  ptyNodePtyMissing:
    "node-pty is unavailable, so the preview runs non-interactively (you cannot type into the command). Install @lydell/node-pty to enable interaction.",
  dirOccupiedSuffix:
    " — enable “Force overwrite” under Advanced options and retry, or pick another directory",
  urlInvalid: "Invalid URL: a full http(s) address is required",
  urlSchemeUnsupported: "URLs must use http(s)",
  argvProgramRequired: "Array mode needs at least the program element (the first argument)",
};

const zhCN: UserMessages = {
  pinHintDarwin:
    "首次打开应用后，右键点击 Dock 中的应用图标，选择“选项 → 在程序坞中保留”，即可固定到 Dock。",
  pinHintWindows:
    "右键点击任务栏中的应用图标，选择“固定到任务栏”即可固定。（OpenTray 尚未生成开始菜单快捷方式）",
  pinHintOther: "可将应用窗口固定到任务栏/收藏夹；Linux 桌面快捷方式生成尚未提供。",
  ptyBunTerminalMissing: "Bun 版本缺少 Bun.Terminal（需要 Bun ≥ 1.2.19），预览以非交互模式运行。",
  ptyNodePtyMissing:
    "node-pty 不可用，预览以非交互模式运行（无法向命令输入内容）。可安装 @lydell/node-pty 启用交互。",
  dirOccupiedSuffix: "；可在「高级选项」中开启 强制覆盖 后重试",
  urlInvalid: "URL 无效：需要完整的 http(s) 地址",
  urlSchemeUnsupported: "URL 仅支持 http(s) 地址",
  argvProgramRequired: "数组模式至少需要程序元素（第一个参数）",
};

const ja: UserMessages = {
  pinHintDarwin:
    "初回起動後、Dock のアプリアイコンを右クリックし「オプション → Dock に保管」で固定できます。",
  pinHintWindows:
    "タスクバーのアプリアイコンを右クリックし「タスクバーにピン留め」で固定できます。（スタートメニューのショートカット生成には未対応）",
  pinHintOther:
    "アプリウィンドウはタスクバー/お気に入りに固定できます。Linux デスクトップのショートカット生成は未提供です。",
  ptyBunTerminalMissing:
    "この Bun には Bun.Terminal がありません（Bun ≥ 1.2.19 が必要）。プレビューは非対話モードで動作します。",
  ptyNodePtyMissing:
    "node-pty を利用できないため、プレビューは非対話モードで動作します（コマンドに入力できません）。@lydell/node-pty をインストールすると対話できます。",
  dirOccupiedSuffix: " — 「詳細オプション」で 強制上書き を有効にして再試行するか、別のディレクトリを選択してください",
  urlInvalid: "URL が無効です：完全な http(s) アドレスが必要です",
  urlSchemeUnsupported: "URL は http(s) のみ対応しています",
  argvProgramRequired: "配列モードにはプログラム要素（先頭の引数）が必須です",
};

const ko: UserMessages = {
  pinHintDarwin: "앱을 처음 연 후 Dock의 앱 아이콘을 우클릭하고 “옵션 → Dock에 유지”를 선택하면 고정됩니다.",
  pinHintWindows:
    "작업표시줄의 앱 아이콘을 우클릭하고 “작업표시줄에 고정”을 선택하세요. (시작 메뉴 바로 가기 생성은 아직 미지원)",
  pinHintOther: "앱 창을 작업표시줄/즐겨찾기에 고정할 수 있습니다. Linux 바탕화면 바로 가기 생성은 아직 제공되지 않습니다.",
  ptyBunTerminalMissing: "이 Bun 빌드에는 Bun.Terminal이 없습니다(Bun ≥ 1.2.19 필요). 미리보기는 비대화형으로 실행됩니다.",
  ptyNodePtyMissing:
    "node-pty를 사용할 수 없어 미리보기가 비대화형으로 실행됩니다(명령에 입력할 수 없음). @lydell/node-pty를 설치하면 대화형으로 사용할 수 있습니다.",
  dirOccupiedSuffix: " — “고급 옵션”에서 강제 덮어쓰기를 켜고 다시 시도하거나 다른 디렉터리를 선택하세요",
  urlInvalid: "잘못된 URL: 전체 http(s) 주소가 필요합니다",
  urlSchemeUnsupported: "URL은 http(s)만 지원합니다",
  argvProgramRequired: "배열 모드에는 프로그램 요소(첫 번째 인자)가 필요합니다",
};

const ar: UserMessages = {
  pinHintDarwin:
    "بعد أول تشغيل للتطبيق، انقر بزر الفأرة الأيمن على أيقونته في Dock واختر «خيارات → الاحتفاظ في Dock» لتثبيتها.",
  pinHintWindows:
    "انقر بزر الفأرة الأيمن على أيقونة التطبيق في شريط المهام واختر «تثبيت في شريط المهام». (لم يوفر OpenTray اختصارات قائمة ابدأ بعد)",
  pinHintOther:
    "يمكن تثبيت نافذة التطبيق في شريط المهام/المفضلة؛ ولم تُوفَّر أداة إنشاء اختصارات سطح المكتب في Linux بعد.",
  ptyBunTerminalMissing:
    "هذا الإصدار من Bun يفتقد Bun.Terminal (يلزم Bun ≥ 1.2.19)؛ يعمل المعاينة في وضع غير تفاعلي.",
  ptyNodePtyMissing:
    "node-pty غير متاح، لذا تعمل المعاينة في وضع غير تفاعلي (لا يمكن الكتابة إلى الأمر). ثبّت @lydell/node-pty لتمكين التفاعل.",
  dirOccupiedSuffix: " — فعّل «الكتابة فوق بالقوة» في الخيارات المتقدمة وأعد المحاولة، أو اختر دليلًا آخر",
  urlInvalid: "عنوان URL غير صالح: يلزم عنوان http(s) كامل",
  urlSchemeUnsupported: "يدعم URL مخطط http(s) فقط",
  argvProgramRequired: "يتطلب وضع المصفوفة عنصر البرنامج (الوسيطة الأولى) على الأقل",
};

const fr: UserMessages = {
  pinHintDarwin:
    "Après la première ouverture de l'app, faites un clic droit sur son icône dans le Dock et choisissez « Options → Garder dans le Dock » pour l'épingler.",
  pinHintWindows:
    "Faites un clic droit sur l'icône de l'app dans la barre des tâches et choisissez « Épingler à la barre des tâches ». (OpenTray ne génère pas encore de raccourcis du menu Démarrer)",
  pinHintOther:
    "Épinglez la fenêtre de l'app à la barre des tâches/favoris ; la génération de raccourcis bureau Linux n'est pas encore fournie.",
  ptyBunTerminalMissing:
    "Ce build de Bun ne dispose pas de Bun.Terminal (Bun ≥ 1.2.19 requis) ; l'aperçu s'exécute en mode non interactif.",
  ptyNodePtyMissing:
    "node-pty est indisponible, l'aperçu s'exécute donc en mode non interactif (impossible de saisir dans la commande). Installez @lydell/node-pty pour activer l'interaction.",
  dirOccupiedSuffix:
    " — activez « Écrasement forcé » dans les options avancées et réessayez, ou choisissez un autre répertoire",
  urlInvalid: "URL invalide : une adresse http(s) complète est requise",
  urlSchemeUnsupported: "Les URL doivent utiliser http(s)",
  argvProgramRequired: "Le mode tableau exige au moins l'élément programme (le premier argument)",
};

const es: UserMessages = {
  pinHintDarwin:
    "Tras abrir la app por primera vez, haz clic derecho en su icono del Dock y elige «Opciones → Mantener en el Dock» para fijarlo.",
  pinHintWindows:
    "Haz clic derecho en el icono de la app en la barra de tareas y elige «Anclar a la barra de tareas». (OpenTray aún no genera accesos del menú Inicio)",
  pinHintOther:
    "Puedes anclar la ventana de la app a la barra de tareas/favoritos; la generación de accesos de escritorio en Linux aún no está disponible.",
  ptyBunTerminalMissing:
    "Esta build de Bun carece de Bun.Terminal (se necesita Bun ≥ 1.2.19); la vista previa se ejecuta en modo no interactivo.",
  ptyNodePtyMissing:
    "node-pty no está disponible, así que la vista previa se ejecuta en modo no interactivo (no puedes escribir en el comando). Instala @lydell/node-pty para habilitar la interacción.",
  dirOccupiedSuffix:
    " — activa «Sobrescritura forzada» en las opciones avanzadas y reintenta, o elige otro directorio",
  urlInvalid: "URL no válida: se requiere una dirección http(s) completa",
  urlSchemeUnsupported: "Las URL deben usar http(s)",
  argvProgramRequired: "El modo array necesita al menos el elemento programa (el primer argumento)",
};

const de: UserMessages = {
  pinHintDarwin:
    "Nach dem ersten Öffnen der App rechts auf ihr Dock-Symbol klicken und „Optionen → Im Dock behalten“ wählen, um sie zu halten.",
  pinHintWindows:
    "Rechts auf das App-Symbol in der Taskleiste klicken und „An Taskleiste anheften“ wählen. (OpenTray erzeugt noch keine Startmenü-Verknüpfungen)",
  pinHintOther:
    "Das App-Fenster lässt sich an Taskleiste/Favoriten anheften; Linux-Desktop-Verknüpfungen werden noch nicht erzeugt.",
  ptyBunTerminalMissing:
    "Dieser Bun-Build fehlt Bun.Terminal (Bun ≥ 1.2.19 erforderlich); die Vorschau läuft nicht interaktiv.",
  ptyNodePtyMissing:
    "node-pty ist nicht verfügbar, daher läuft die Vorschau nicht interaktiv (keine Eingabe in den Befehl möglich). Installiere @lydell/node-pty für Interaktion.",
  dirOccupiedSuffix:
    " — aktiviere „Erzwungenes Überschreiben“ in den erweiterten Optionen und versuche es erneut, oder wähle ein anderes Verzeichnis",
  urlInvalid: "Ungültige URL: eine vollständige http(s)-Adresse ist erforderlich",
  urlSchemeUnsupported: "URLs müssen http(s) verwenden",
  argvProgramRequired: "Der Array-Modus braucht mindestens das Programmelement (das erste Argument)",
};

const ru: UserMessages = {
  pinHintDarwin:
    "После первого запуска приложения кликните правой кнопкой по его значку в Dock и выберите «Параметры → Оставить в Dock».",
  pinHintWindows:
    "Кликните правой кнопкой по значку приложения на панели задач и выберите «Закрепить на панели задач». (OpenTray пока не создаёт ярлыки в меню «Пуск»)",
  pinHintOther:
    "Окно приложения можно закрепить на панели задач/в избранном; создание ярлыков рабочего стола Linux пока не предусмотрено.",
  ptyBunTerminalMissing:
    "В этой сборке Bun нет Bun.Terminal (нужен Bun ≥ 1.2.19); предпросмотр работает в неинтерактивном режиме.",
  ptyNodePtyMissing:
    "node-pty недоступен, поэтому предпросмотр работает в неинтерактивном режиме (ввести данные в команду нельзя). Установите @lydell/node-pty для интерактивности.",
  dirOccupiedSuffix:
    " — включите «Принудительную перезапись» в расширенных настройках и повторите либо выберите другой каталог",
  urlInvalid: "Некорректный URL: требуется полный http(s)-адрес",
  urlSchemeUnsupported: "URL поддерживает только http(s)",
  argvProgramRequired: "В режиме массива нужен хотя бы элемент программы (первый аргумент)",
};

const CATALOGS: Record<UiLocale, UserMessages> = {
  en,
  "zh-CN": zhCN,
  ja,
  ko,
  ar,
  fr,
  es,
  de,
  ru,
};

export const userMessages = (locale: UiLocale): UserMessages => CATALOGS[locale];

/** Localized text for the machine-readable pty-unavailable event codes. */
export const ptyUnavailableMessage = (
  code: "pty_bun_terminal_missing" | "pty_node_pty_missing",
  locale: UiLocale,
): string =>
  code === "pty_bun_terminal_missing"
    ? CATALOGS[locale].ptyBunTerminalMissing
    : CATALOGS[locale].ptyNodePtyMissing;
