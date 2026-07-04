import type { Menu, MenuItem, MenuItemId } from "@opentray/spec";

import type { TrayEventByType } from "./client";

export type CreateTrayMenuClickHandler = (
  event: TrayEventByType<"menuClick">
) => void;

/** App-facing menu input accepted by top-level createTray and setMenu. */
export type CreateTrayMenu = {
  items: CreateTrayMenuItem[];
};

/** Menu item shorthand normalized to protocol MenuItem before runtime transport. */
export type CreateTrayMenuItem =
  | string
  | readonly [title: string, items: readonly CreateTrayMenuItem[]]
  | CreateTrayItem
  | CreateTrayCheckItem
  | CreateTrayRadioItem
  | CreateTraySeparatorItem
  | CreateTraySubmenuItem;

export type CreateTrayItem = {
  type?: "item";
  id?: MenuItemId;
  title: string;
  primaryEvent?: boolean;
  enabled?: boolean;
  shortcut?: string;
  onMenuClick?: CreateTrayMenuClickHandler;
};

export type CreateTrayCheckItem = {
  type: "check";
  id?: MenuItemId;
  title: string;
  enabled?: boolean;
  checked?: boolean;
  onMenuClick?: CreateTrayMenuClickHandler;
};

export type CreateTrayRadioItem = {
  type: "radio";
  id?: MenuItemId;
  title: string;
  enabled?: boolean;
  checked?: boolean;
  group: number;
  onMenuClick?: CreateTrayMenuClickHandler;
};

export type CreateTraySeparatorItem = {
  type: "separator";
};

export type CreateTraySubmenuItem = {
  type: "submenu";
  title: string;
  enabled?: boolean;
  items: readonly CreateTrayMenuItem[];
};

export interface NormalizedCreateTrayMenu {
  menu: Menu;
  handlers: Map<MenuItemId, CreateTrayMenuClickHandler[]>;
}

export const normalizeCreateTrayMenu = (
  menu: CreateTrayMenu
): NormalizedCreateTrayMenu => {
  const state: NormalizeState = {
    usedIds: collectExplicitMenuIds(menu.items),
    nextId: 1,
    handlers: new Map(),
  };
  return {
    menu: {
      items: menu.items.map((item) => normalizeCreateTrayMenuItem(item, state)),
    },
    handlers: state.handlers,
  };
};

const normalizeCreateTrayMenuItem = (
  item: CreateTrayMenuItem,
  state: NormalizeState
): MenuItem => {
  if (typeof item === "string") {
    if (isSeparatorShortcut(item)) {
      return { type: "separator" };
    }
    return normalizePlainItem({ title: item }, state);
  }
  if (isSubmenuTuple(item)) {
    const [title, items] = item;
    return {
      type: "submenu",
      title,
      items: items.map((child) => normalizeCreateTrayMenuItem(child, state)),
    };
  }
  switch (item.type) {
    case undefined:
    case "item":
      return normalizePlainItem(item, state);
    case "check":
      return normalizeCheckItem(item, state);
    case "radio":
      return normalizeRadioItem(item, state);
    case "separator":
      return item;
    case "submenu":
      return {
        type: "submenu",
        title: item.title,
        ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
        items: item.items.map((child) =>
          normalizeCreateTrayMenuItem(child, state)
        ),
      };
  }
  throw new Error("unsupported menu item");
};

const normalizeClickableItem = (
  item: {
    id?: MenuItemId;
    onMenuClick?: CreateTrayMenuClickHandler;
  },
  state: NormalizeState
): MenuItemId => {
  const id = item.id ?? allocateMenuItemId(state);
  registerClickId(state, id);
  if (item.onMenuClick !== undefined) {
    const handlers = state.handlers.get(id) ?? [];
    handlers.push(item.onMenuClick);
    state.handlers.set(id, handlers);
  }
  return id;
};

const normalizePlainItem = (
  item: CreateTrayItem,
  state: NormalizeState
): Extract<MenuItem, { type: "item" }> => {
  const id = normalizeClickableItem(item, state);
  return {
    type: "item",
    id,
    title: item.title,
    ...(item.primaryEvent === undefined
      ? {}
      : { primaryEvent: item.primaryEvent }),
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.shortcut === undefined ? {} : { shortcut: item.shortcut }),
  };
};

const normalizeCheckItem = (
  item: CreateTrayCheckItem,
  state: NormalizeState
): Extract<MenuItem, { type: "check" }> => {
  const id = normalizeClickableItem(item, state);
  return {
    type: "check",
    id,
    title: item.title,
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.checked === undefined ? {} : { checked: item.checked }),
  };
};

const normalizeRadioItem = (
  item: CreateTrayRadioItem,
  state: NormalizeState
): Extract<MenuItem, { type: "radio" }> => {
  const id = normalizeClickableItem(item, state);
  return {
    type: "radio",
    id,
    title: item.title,
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.checked === undefined ? {} : { checked: item.checked }),
    group: item.group,
  };
};

const allocateMenuItemId = (state: NormalizeState): MenuItemId => {
  while (state.usedIds.has(state.nextId)) {
    state.nextId += 1;
  }
  const id = state.nextId;
  state.usedIds.add(id);
  state.nextId += 1;
  return id;
};

const collectExplicitMenuIds = (
  items: readonly CreateTrayMenuItem[]
): Set<MenuItemId> => {
  const ids = new Set<MenuItemId>();
  for (const item of items) {
    if (typeof item === "string") {
      continue;
    }
    if (isSubmenuTuple(item)) {
      for (const id of collectExplicitMenuIds(item[1])) {
        ids.add(id);
      }
      continue;
    }
    switch (item.type) {
      case undefined:
      case "item":
      case "check":
      case "radio":
        if (item.id !== undefined) {
          ids.add(item.id);
        }
        break;
      case "submenu":
        for (const id of collectExplicitMenuIds(item.items)) {
          ids.add(id);
        }
        break;
      case "separator":
        break;
    }
  }
  return ids;
};

const isSeparatorShortcut = (value: string): boolean => /^-+$/.test(value);

const isSubmenuTuple = (
  item: CreateTrayMenuItem
): item is readonly [title: string, items: readonly CreateTrayMenuItem[]] =>
  Array.isArray(item);

const registerClickId = (state: NormalizeState, id: MenuItemId): void => {
  const seen = state.seenClickIds ?? new Set<MenuItemId>();
  if (seen.has(id)) {
    throw new Error(`duplicate menu item id: ${id}`);
  }
  seen.add(id);
  state.seenClickIds = seen;
};

interface NormalizeState {
  usedIds: Set<MenuItemId>;
  nextId: MenuItemId;
  handlers: Map<MenuItemId, CreateTrayMenuClickHandler[]>;
  seenClickIds?: Set<MenuItemId>;
}
