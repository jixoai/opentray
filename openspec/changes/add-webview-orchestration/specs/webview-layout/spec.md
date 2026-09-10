## ADDED Requirements

### Requirement: Window layout SHALL be a declarative layered flex protocol

A webview window SHALL accept a layout tree as one JSON document: an ordered array of layers (bottom-to-top; array order is the z-order), where each layer owns one independent flex tree. A tree node SHALL be either a container (`dir: row|column`, `gap`, `children`) or a view reference resolved through the View Registry by id. Node sizing SHALL be limited to `width`, `height`, `flex`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` — logical pixels, client-area coordinates. Padding, align, justify, percent sizes, and flex-basis are outside the v1 protocol. There SHALL be no zIndex field anywhere: stacking order is the layer array order plus sibling order inside each tree. The TypeScript surface MAY provide `row()/column()/view()/fixed()/grow()` builders, but they SHALL be pure syntax sugar that compiles to this object protocol.

A layout tree referencing a view id that no registered view owns SHALL be rejected with a typed error before any native geometry changes. An empty or unset layout SHALL fall back to the default layout: one layer containing the window's first registered webview filling the window.

#### Scenario: Toolbar layout is one declarative document

- **GIVEN** a window with registered webviews `toolbar` and `content`
- **WHEN** the caller submits `column([fixed("toolbar", 44), grow("content")])` as the single-layer layout
- **THEN** both webviews SHALL be positioned natively with `toolbar` at 44 logical pixels from the top and `content` filling the remainder
- **AND** the submission SHALL be one JSON document, not per-view geometry commands

#### Scenario: Unknown view id is a typed error

- **GIVEN** a layout tree referencing view id `sidebar` with no registered owner
- **WHEN** `setLayout` is called
- **THEN** the extension SHALL reject the tree with a typed error naming the unknown id
- **AND** the previously applied layout SHALL remain in effect unchanged

#### Scenario: Layers stack bottom-to-top with cutouts

- **GIVEN** a bottom layer whose tree fills the window with webview `content` and a top layer whose tree covers only a strip with view `banner`
- **WHEN** the layout is applied and the window rendered
- **THEN** `content` SHALL be visible through every region the top layer's tree does not cover
- **AND** reordering the layer array SHALL reorder stacking without any zIndex field

### Requirement: Layout solving SHALL be native and resize-authoritative

Layout SHALL be solved by a native flex engine (Taffy) per layer. Window resize SHALL trigger native re-solve and native frame application for every affected view; the JS side SHALL never compute view coordinates and SHALL never participate in resize relayout. `setLayout(tree)` SHALL atomically replace the current layout document; `layout.update(viewId, patch)` SHALL update one node's sizing fields incrementally. Both operations SHALL preserve every other view's identity — replacing a layout SHALL never recreate webview browsing contexts that remain referenced by id in the new tree.

#### Scenario: Live resize does not round-trip through JS

- **GIVEN** an applied layered layout
- **WHEN** the operator resizes the window by dragging
- **THEN** every view rect SHALL be recomputed natively and track the drag
- **AND** no per-frame layout IPC to the JS caller SHALL be required for the relayout

#### Scenario: Replacing a layout preserves browsing contexts

- **GIVEN** webview `content` with a loaded page under layout A
- **WHEN** the caller applies layout B that still references `content`
- **THEN** `content` SHALL move without its page reloading or its session being recreated

### Requirement: A box view SHALL be the decorative paint primitive

The View Registry SHALL accept a `box` view kind as the first member of a native control family: a leaf rectangle that participates in flex solving and paints `background` (solid color), `border` (`width` + `color`), and `cornerRadius`. A box SHALL carry no web content. Box views SHALL be input pass-through: input over a box rect SHALL reach the view below it in stacking order. Layers themselves SHALL remain pure geometry groups and SHALL NOT paint.

#### Scenario: A border rings a webview through one box

- **GIVEN** webview `content` filling the window in a bottom layer
- **WHEN** a top layer places a box with `border { width: 2 }` and no background over the same region as `content`
- **THEN** the border SHALL be visible around `content`
- **AND** pointer input inside the box rect SHALL reach `content`, not be swallowed by the box
