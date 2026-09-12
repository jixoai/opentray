//! Platform-neutral declarative layout engine (add-webview-orchestration
//! D3/D4/D7/D8/D21/D23).
//!
//! This module owns everything about a layout document that does not touch a
//! native UI toolkit: the Taffy flex solving (one independent tree per layer,
//! stacked bottom-to-top by array order), the per-view overlay/titlebar
//! safe-area projection, drag-region translation, incremental sizing patches,
//! and the applied-layout state (`WindowLayoutState`) that platform runtimes
//! embed next to their native view registries.
//!
//! Laws projected here:
//! - **Solve discipline (D21):** solving works in logical pixels;
//!   platform runtimes convert to native pixels through the window's current
//!   scale factor at frame-application time. Input validation
//!   ([`opentray_spec::webview::validate_webview_layout`]) always runs before
//!   solving — NaN/±∞/negative/inverted measures and unregistered view ids
//!   reject with the typed codes before any geometry exists.
//! - **Layer semantics (D4):** the layer array *is* the z-order (bottom-to-
//!   top); inside one tree, later siblings stack above earlier ones. There is
//!   no zIndex field anywhere.
//! - **Resize authority (D7):** the solver is a pure function of
//!   (document, viewport). Window resize re-runs it natively; the JS side
//!   never computes coordinates.
//! - **Root fill default:** every layer's root fills the window's client area
//!   unless its own sizing fields constrain it (mirrors the protocol's
//!   default-layout law for single-view windows).
//! - **Overlay projection (D23):** [`project_overlay_safe_area`] intersects
//!   the window-level safe area with one view's layout rect and translates
//!   the result into view-local coordinates; no intersection yields `None`.
//!   A view that fills the client area receives the window-level values
//!   unchanged.
//!
//! Taffy is a dependency of `opentray-ext-webview` only (never opentray-core)
//! and its exact version is frozen by the repository root `Cargo.lock`.

use std::collections::{HashMap, HashSet};

use opentray_spec::webview::{
    validate_webview_layout, WebviewBoxStyle, WebviewErrorEnvelope, WebviewGeometryRect,
    WebviewLayoutDirection, WebviewLayoutDocument, WebviewLayoutNode, WebviewLayoutSizing,
};
use taffy::prelude::{AvailableSpace, Dimension, LengthPercentage, Size, TaffyTree};

use crate::orchestration::OrchestrationError;

/// Logical-pixel rectangle in client-area coordinates with a **top-left**
/// origin (the protocol's coordinate system; native runtimes flip to the
/// platform's frame convention at the apply boundary).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl LogicalRect {
    pub(crate) fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self { x, y, width, height }
    }

    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn bottom(&self) -> f64 {
        self.y + self.height
    }

    /// The wire DTO form (same fields; used for the frozen event payload).
    pub(crate) fn to_geometry_rect(self) -> WebviewGeometryRect {
        WebviewGeometryRect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

/// Logical-pixel viewport (client-area) size.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct LogicalViewport {
    pub width: f64,
    pub height: f64,
}

/// Identity of one positioned view inside a solved layout. `is_box` selects
/// the View Registry family the apply step dispatches to; a webview and a box
/// may legally share a spelling because the solver namespaces them by kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LayoutViewKey {
    pub id: String,
    pub is_box: bool,
}

/// One positioned view: solved rect plus the stacking/visibility facts the
/// native transaction applies.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SolvedView {
    pub key: LayoutViewKey,
    pub rect: LogicalRect,
    /// False when the owning layer declared `visible: false`.
    pub visible: bool,
    /// Box paint style snapshot (webviews carry `None`).
    pub box_style: Option<WebviewBoxStyle>,
}

/// Pure solve result for one layout document against one viewport. `views` is
/// in stacking order, bottom-to-top (layer array order, then sibling order
/// inside each tree). A view referenced more than once resolves to its last
/// occurrence — the later layer is the stacking authority.
#[derive(Debug, Clone, Default)]
pub(crate) struct LayoutSolution {
    pub views: Vec<SolvedView>,
}

impl LayoutSolution {
    /// Rect of the last occurrence of `id` in stacking order, if positioned.
    pub(crate) fn rect_for(&self, id: &str) -> Option<LogicalRect> {
        self.views
            .iter()
            .rev()
            .find(|view| view.key.id == id)
            .map(|view| view.rect)
    }
}

/// Default layout (D8): one layer containing the window's first registered
/// webview filling the window. Used while no explicit document exists.
pub(crate) fn default_layout_document(first_view_id: &str) -> WebviewLayoutDocument {
    WebviewLayoutDocument {
        layers: vec![opentray_spec::webview::WebviewLayoutLayer {
            root: WebviewLayoutNode::WebviewView(opentray_spec::webview::WebviewLayoutViewNode {
                kind: None,
                id: first_view_id.to_string(),
                sizing: WebviewLayoutSizing {
                    flex: Some(1.0),
                    ..WebviewLayoutSizing::default()
                },
            }),
            visible: true,
        }],
    }
}

/// Validated solve: protocol validation first (typed `unknown_view` /
/// `invalid_layout_measure` rejections before any Taffy work), then the pure
/// per-layer flex solve. `has_view` answers whether a view id is registered;
/// the document's own box declarations count as registrations so box nodes
/// are self-validating.
pub(crate) fn validated_solve(
    document: &WebviewLayoutDocument,
    has_view: &dyn Fn(&str) -> bool,
    viewport: LogicalViewport,
) -> Result<LayoutSolution, OrchestrationError> {
    validate_webview_layout(document, &registry_with_document_boxes(document, has_view))
        .map_err(typed)?;
    solve_layout(document, viewport)
}

fn typed(envelope: WebviewErrorEnvelope) -> OrchestrationError {
    OrchestrationError { envelope }
}

fn registry_with_document_boxes<'a>(
    document: &'a WebviewLayoutDocument,
    has_view: &'a dyn Fn(&str) -> bool,
) -> impl Fn(&str) -> bool + 'a {
    let boxes = collect_box_ids(document);
    move |id: &str| has_view(id) || boxes.contains(id)
}

/// Internal solver failure — unreachable from protocol-valid input; the
/// `invalid_layout_measure` code keeps the frozen envelope shape so command
/// paths never emit an untyped error.
fn internal(error: taffy::TaffyError) -> OrchestrationError {
    OrchestrationError::new(
        opentray_spec::webview::OrchestrationErrorCode::InvalidLayoutMeasure,
        format!("layout engine internal failure: {error}"),
    )
}

/// Pure per-layer Taffy solve. Assumes the document already passed protocol
/// validation (command paths call [`validated_solve`]).
pub(crate) fn solve_layout(
    document: &WebviewLayoutDocument,
    viewport: LogicalViewport,
) -> Result<LayoutSolution, OrchestrationError> {
    let mut solution = LayoutSolution::default();
    if !(viewport.width.is_finite() && viewport.height.is_finite()) {
        return Ok(solution);
    }
    for layer in &document.layers {
        solve_layer(&layer.root, layer.visible, viewport, &mut solution)?;
    }
    Ok(solution)
}

/// One layer = one independent Taffy tree. An implicit column container fills
/// the layer viewport and holds the layer root as its only child, so the root
/// fills the window unless its own sizing constrains it — exactly the
/// single-view default-layout behavior, generalized.
fn solve_layer(
    root: &WebviewLayoutNode,
    layer_visible: bool,
    viewport: LogicalViewport,
    solution: &mut LayoutSolution,
) -> Result<(), OrchestrationError> {
    let mut tree: TaffyTree = TaffyTree::new();
    let mut leaves = HashMap::new();
    let root_node = build_node(&mut tree, root, &mut leaves, true)?;
    let implicit = tree
        .new_with_children(
            taffy::style::Style {
                flex_direction: taffy::style::FlexDirection::Column,
                // Taffy 0.9 sizes an auto root by its content, so the fill
                // must be explicit: 100% resolves against the definite
                // viewport available space handed to `compute_layout`.
                size: Size {
                    width: Dimension::percent(1.0),
                    height: Dimension::percent(1.0),
                },
                ..Default::default()
            },
            &[root_node],
        )
        .map_err(internal)?;
    tree.compute_layout(
        implicit,
        Size {
            width: AvailableSpace::Definite(viewport.width as f32),
            height: AvailableSpace::Definite(viewport.height as f32),
        },
    )
    .map_err(internal)?;
    collect_layer(&tree, implicit, 0.0, 0.0, layer_visible, &leaves, solution);
    Ok(())
}

/// Builds the Taffy subtree for one protocol node, recording leaf views in
/// `leaves` (Taffy node id → view identity). `is_layer_root` merges the
/// implicit fill (grow 1) into the root's style; a declared `flex` overrides
/// the fill factor.
fn build_node(
    tree: &mut TaffyTree,
    node: &WebviewLayoutNode,
    leaves: &mut HashMap<taffy::tree::NodeId, (LayoutViewKey, Option<WebviewBoxStyle>)>,
    is_layer_root: bool,
) -> Result<taffy::tree::NodeId, OrchestrationError> {
    match node {
        WebviewLayoutNode::Container(container) => {
            let direction = match container.dir {
                WebviewLayoutDirection::Row => taffy::style::FlexDirection::Row,
                WebviewLayoutDirection::Column => taffy::style::FlexDirection::Column,
            };
            let mut style = taffy::style::Style {
                flex_direction: direction,
                ..Default::default()
            };
            apply_sizing(&mut style, &container.sizing, is_layer_root);
            if let Some(gap) = container.gap {
                style.gap = Size {
                    width: LengthPercentage::length(gap as f32),
                    height: LengthPercentage::length(gap as f32),
                };
            }
            let mut children = Vec::with_capacity(container.children.len());
            for child in &container.children {
                children.push(build_node(tree, child, leaves, false)?);
            }
            tree.new_with_children(style, &children).map_err(internal)
        }
        WebviewLayoutNode::WebviewView(view) => {
            let mut style = taffy::style::Style::default();
            apply_sizing(&mut style, &view.sizing, is_layer_root);
            let node_id = tree.new_leaf(style).map_err(internal)?;
            leaves.insert(node_id, (LayoutViewKey { id: view.id.clone(), is_box: false }, None));
            Ok(node_id)
        }
        WebviewLayoutNode::BoxView(box_node) => {
            let mut style = taffy::style::Style::default();
            apply_sizing(&mut style, &box_node.sizing, is_layer_root);
            let node_id = tree.new_leaf(style).map_err(internal)?;
            leaves.insert(
                node_id,
                (LayoutViewKey { id: box_node.id.clone(), is_box: true }, Some(box_node.style.clone())),
            );
            Ok(node_id)
        }
    }
}

/// Maps protocol sizing fields onto a Taffy style. The v1 subset is
/// width/height/flex/min*/max* only — no padding/align/justify/percent/basis.
/// `flex` maps to `flex_grow`; `flex_shrink` keeps the CSS default of 1.0;
/// the layer-root fill merges as `flex.unwrap_or(1.0)` — except that an
/// explicit main-axis size anchors the layer root (the implicit parent is
/// always a column, so the main axis is `height`): a strip layer with
/// `height: 24` keeps 24 logical pixels at the top instead of growing to
/// fill the viewport.
fn apply_sizing(style: &mut taffy::style::Style, sizing: &WebviewLayoutSizing, is_layer_root: bool) {
    if let Some(width) = sizing.width {
        style.size.width = Dimension::length(width as f32);
    }
    if let Some(height) = sizing.height {
        style.size.height = Dimension::length(height as f32);
    }
    if let Some(min_width) = sizing.min_width {
        style.min_size.width = Dimension::length(min_width as f32);
    }
    if let Some(min_height) = sizing.min_height {
        style.min_size.height = Dimension::length(min_height as f32);
    }
    if let Some(max_width) = sizing.max_width {
        style.max_size.width = Dimension::length(max_width as f32);
    }
    if let Some(max_height) = sizing.max_height {
        style.max_size.height = Dimension::length(max_height as f32);
    }
    let grow = if is_layer_root {
        match (sizing.flex, sizing.height) {
            // A declared flex overrides the fill factor (and may still grow
            // past a declared base height, CSS-style).
            (Some(flex), _) => flex,
            // Explicit main-axis size: the layer root anchors, no fill.
            (None, Some(_)) => 0.0,
            // Unconstrained main axis: fill the layer viewport.
            (None, None) => 1.0,
        }
    } else {
        sizing.flex.unwrap_or(0.0)
    };
    style.flex_grow = grow as f32;
}

/// Post-solve walk over one layer's Taffy tree: accumulates relative node
/// locations into absolute (client-area, top-left) origins and emits leaves
/// in stacking order (later siblings above earlier ones — CSS paint order).
fn collect_layer(
    tree: &TaffyTree,
    node: taffy::tree::NodeId,
    origin_x: f64,
    origin_y: f64,
    layer_visible: bool,
    leaves: &HashMap<taffy::tree::NodeId, (LayoutViewKey, Option<WebviewBoxStyle>)>,
    solution: &mut LayoutSolution,
) {
    let (location, size) = tree
        .layout(node)
        .map(|layout| {
            (
                (layout.location.x as f64, layout.location.y as f64),
                (layout.size.width as f64, layout.size.height as f64),
            )
        })
        .unwrap_or(((0.0, 0.0), (0.0, 0.0)));
    let absolute_x = origin_x + location.0;
    let absolute_y = origin_y + location.1;
    if let Some((key, box_style)) = leaves.get(&node) {
        let solved = SolvedView {
            key: key.clone(),
            rect: LogicalRect::new(absolute_x, absolute_y, size.0.max(0.0), size.1.max(0.0)),
            visible: layer_visible,
            box_style: box_style.clone(),
        };
        match solution.views.iter_mut().find(|view| view.key == *key) {
            Some(existing) => *existing = solved,
            None => solution.views.push(solved),
        }
    }
    let children: Vec<taffy::tree::NodeId> = tree
        .children(node)
        .map(|children| children.to_vec())
        .unwrap_or_default();
    for child in children {
        collect_layer(tree, child, absolute_x, absolute_y, layer_visible, leaves, solution);
    }
}

fn collect_box_ids(document: &WebviewLayoutDocument) -> HashSet<String> {
    let mut ids = HashSet::new();
    for layer in &document.layers {
        collect_box_ids_node(&layer.root, &mut ids);
    }
    ids
}

fn collect_box_ids_node(node: &WebviewLayoutNode, ids: &mut HashSet<String>) {
    match node {
        WebviewLayoutNode::BoxView(box_node) => {
            ids.insert(box_node.id.clone());
        }
        WebviewLayoutNode::WebviewView(_) => {}
        WebviewLayoutNode::Container(container) => {
            for child in &container.children {
                collect_box_ids_node(child, ids);
            }
        }
    }
}

/// D23 per-view overlay/titlebar safe-area projection: intersect the
/// window-level safe-area rect with the view's layout rect, then translate
/// into view-local coordinates. No intersection → `None` (the wire `null`).
/// A view covering the full client area receives the window-level values
/// unchanged, which is exactly the single-webview regression contract.
pub(crate) fn project_overlay_safe_area(
    window_safe_area: LogicalRect,
    view_rect: LogicalRect,
) -> Option<LogicalRect> {
    let left = window_safe_area.x.max(view_rect.x);
    let top = window_safe_area.y.max(view_rect.y);
    let right = window_safe_area.right().min(view_rect.right());
    let bottom = window_safe_area.bottom().min(view_rect.bottom());
    if right <= left || bottom <= top {
        return None;
    }
    Some(LogicalRect::new(
        left - view_rect.x,
        top - view_rect.y,
        right - left,
        bottom - top,
    ))
}

/// D23 drag-region translation: a page-declared drag region arrives in the
/// declaring webview's local coordinates; the native hit-test surface needs
/// the same region in window client coordinates. Windows (WM_NCHITTEST
/// routing) consumes this directly in its generalization batch; macOS drag is
/// event-driven (`startAppRegionDrag`) and stores no static regions, so no
/// stale translation can survive a layout commit there.
// Unused until the Windows generalization batch wires WM_NCHITTEST; the
// translation contract itself is frozen by the tests below.
#[allow(dead_code)]
pub(crate) fn translate_drag_region(
    view_rect: LogicalRect,
    local_region: LogicalRect,
) -> LogicalRect {
    LogicalRect::new(
        view_rect.x + local_region.x,
        view_rect.y + local_region.y,
        local_region.width,
        local_region.height,
    )
}

/// `layout.update(viewId, patch)` (D7): merge the patch's present sizing
/// fields into every node carrying that id (absent fields keep their current
/// values — the frozen DTO cannot express clearing, so null means "no
/// change"). Returns false when no node carries the id.
pub(crate) fn apply_sizing_patch(
    document: &mut WebviewLayoutDocument,
    view_id: &str,
    patch: &WebviewLayoutSizing,
) -> bool {
    let mut applied = false;
    for layer in &mut document.layers {
        apply_sizing_patch_node(&mut layer.root, view_id, patch, &mut applied);
    }
    applied
}

fn apply_sizing_patch_node(
    node: &mut WebviewLayoutNode,
    view_id: &str,
    patch: &WebviewLayoutSizing,
    applied: &mut bool,
) {
    match node {
        WebviewLayoutNode::Container(container) => {
            for child in &mut container.children {
                apply_sizing_patch_node(child, view_id, patch, applied);
            }
        }
        WebviewLayoutNode::WebviewView(view) => {
            if view.id == view_id {
                merge_sizing(&mut view.sizing, patch);
                *applied = true;
            }
        }
        WebviewLayoutNode::BoxView(box_node) => {
            if box_node.id == view_id {
                merge_sizing(&mut box_node.sizing, patch);
                *applied = true;
            }
        }
    }
}

fn merge_sizing(current: &mut WebviewLayoutSizing, patch: &WebviewLayoutSizing) {
    let fields: [(&mut Option<f64>, Option<f64>); 7] = [
        (&mut current.width, patch.width),
        (&mut current.height, patch.height),
        (&mut current.flex, patch.flex),
        (&mut current.min_width, patch.min_width),
        (&mut current.min_height, patch.min_height),
        (&mut current.max_width, patch.max_width),
        (&mut current.max_height, patch.max_height),
    ];
    for (slot, value) in fields {
        if value.is_some() {
            *slot = value;
        }
    }
}

/// Applied layout state embedded next to the platform view registry: the
/// active document (explicit or `None` for the default single-fill layout),
/// the last applied per-view rects, and the last applied stacking order.
/// Platform runtimes own the native resources; this is the bookkeeping they
/// read for queries (per-view overlay projection) and resize re-solves.
#[derive(Debug, Default)]
pub(crate) struct WindowLayoutState {
    /// Explicit layout document. `None` = default layout: the window's first
    /// registered webview fills the client area (expressed natively by the
    /// primary webview's autoresizing until the first explicit commit).
    pub document: Option<WebviewLayoutDocument>,
    /// Last applied logical rect per view id. Views of both families key by
    /// their id; `z_order` disambiguates native targets by `is_box`.
    pub rects: HashMap<String, LogicalRect>,
    /// Last applied stacking order, bottom-to-top.
    pub z_order: Vec<LayoutViewKey>,
}

impl WindowLayoutState {
    /// Effective document for solving: the explicit one, or the default
    /// single-fill layout over the first registered view.
    pub(crate) fn effective_document(&self, first_view_id: Option<&str>) -> WebviewLayoutDocument {
        self.document
            .clone()
            .unwrap_or_else(|| default_layout_document(first_view_id.unwrap_or("")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentray_spec::webview::OrchestrationErrorCode;
    use serde_json::json;

    fn solve_json(root: serde_json::Value, viewport: LogicalViewport) -> LayoutSolution {
        let document = WebviewLayoutDocument {
            layers: vec![opentray_spec::webview::WebviewLayoutLayer {
                root: serde_json::from_value(root).expect("layout root"),
                visible: true,
            }],
        };
        solve_layout(&document, viewport).expect("solve")
    }

    fn rect_of(solution: &LayoutSolution, id: &str) -> LogicalRect {
        solution.rect_for(id).expect("positioned view")
    }

    #[test]
    fn toolbar_column_layout_positions_both_webviews() {
        let solution = solve_json(
            json!({
                "dir": "column",
                "children": [
                    { "id": "toolbar", "height": 44 },
                    { "id": "content", "flex": 1 }
                ]
            }),
            LogicalViewport { width: 800.0, height: 600.0 },
        );
        assert_eq!(rect_of(&solution, "toolbar"), LogicalRect::new(0.0, 0.0, 800.0, 44.0));
        assert_eq!(rect_of(&solution, "content"), LogicalRect::new(0.0, 44.0, 800.0, 556.0));
    }

    #[test]
    fn gap_offsets_siblings() {
        let solution = solve_json(
            json!({
                "dir": "column",
                "gap": 8,
                "children": [
                    { "id": "toolbar", "height": 44 },
                    { "id": "content", "flex": 1 }
                ]
            }),
            LogicalViewport { width: 800.0, height: 600.0 },
        );
        assert_eq!(rect_of(&solution, "toolbar"), LogicalRect::new(0.0, 0.0, 800.0, 44.0));
        assert_eq!(rect_of(&solution, "content"), LogicalRect::new(0.0, 52.0, 800.0, 548.0));
    }

    #[test]
    fn flex_distributes_free_space_by_ratio() {
        let solution = solve_json(
            json!({
                "dir": "row",
                "children": [
                    { "id": "a", "flex": 1 },
                    { "id": "b", "flex": 2 }
                ]
            }),
            LogicalViewport { width: 900.0, height: 600.0 },
        );
        assert_eq!(rect_of(&solution, "a"), LogicalRect::new(0.0, 0.0, 300.0, 600.0));
        assert_eq!(rect_of(&solution, "b"), LogicalRect::new(300.0, 0.0, 600.0, 600.0));
    }

    #[test]
    fn min_and_max_clamp_resolved_sizes() {
        let solution = solve_json(
            json!({
                "dir": "row",
                "children": [
                    { "id": "a", "width": 100, "minWidth": 200 },
                    { "id": "b", "flex": 1 }
                ]
            }),
            LogicalViewport { width: 800.0, height: 600.0 },
        );
        assert_eq!(rect_of(&solution, "a"), LogicalRect::new(0.0, 0.0, 200.0, 600.0));
        assert_eq!(rect_of(&solution, "b"), LogicalRect::new(200.0, 0.0, 600.0, 600.0));

        let solution = solve_json(
            json!({
                "dir": "row",
                "children": [
                    { "id": "a", "flex": 1, "maxWidth": 250 },
                    { "id": "b", "flex": 1 }
                ]
            }),
            LogicalViewport { width: 800.0, height: 600.0 },
        );
        assert_eq!(rect_of(&solution, "a").width, 250.0);
        assert_eq!(rect_of(&solution, "b").width, 550.0);
    }

    #[test]
    fn nested_containers_solve_with_absolute_offsets() {
        let solution = solve_json(
            json!({
                "dir": "column",
                "children": [
                    { "id": "toolbar", "height": 44 },
                    {
                        "dir": "row",
                        "flex": 1,
                        "children": [
                            { "id": "sidebar", "width": 240 },
                            { "id": "editor", "flex": 1 }
                        ]
                    }
                ]
            }),
            LogicalViewport { width: 1280.0, height: 800.0 },
        );
        assert_eq!(rect_of(&solution, "toolbar"), LogicalRect::new(0.0, 0.0, 1280.0, 44.0));
        assert_eq!(rect_of(&solution, "sidebar"), LogicalRect::new(0.0, 44.0, 240.0, 756.0));
        assert_eq!(rect_of(&solution, "editor"), LogicalRect::new(240.0, 44.0, 1040.0, 756.0));
    }

    #[test]
    fn layered_cutout_solves_each_layer_independently() {
        let document: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [
                { "root": { "id": "content", "flex": 1 } },
                { "root": { "id": "banner", "height": 24 } },
                { "root": { "kind": "box", "id": "ring", "width": 120, "height": 40 } }
            ]
        }))
        .expect("document");
        let solution =
            solve_layout(&document, LogicalViewport { width: 800.0, height: 600.0 }).expect("solve");
        // Bottom layer fills; the strip root stretches cross-axis and keeps
        // its main-axis height at the top; the box keeps its explicit size.
        assert_eq!(rect_of(&solution, "content"), LogicalRect::new(0.0, 0.0, 800.0, 600.0));
        assert_eq!(rect_of(&solution, "banner"), LogicalRect::new(0.0, 0.0, 800.0, 24.0));
        assert_eq!(rect_of(&solution, "ring"), LogicalRect::new(0.0, 0.0, 120.0, 40.0));
        // Stacking order = layer array order (bottom-to-top).
        let order: Vec<&str> = solution.views.iter().map(|v| v.key.id.as_str()).collect();
        assert_eq!(order, vec!["content", "banner", "ring"]);
        assert!(solution.views[2].key.is_box);
        assert!(solution.views[2].box_style.is_some());
    }

    #[test]
    fn hidden_layer_keeps_geometry_but_marks_views_hidden() {
        let document: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [
                { "root": { "id": "content", "flex": 1 } },
                { "root": { "id": "banner", "height": 24 }, "visible": false }
            ]
        }))
        .expect("document");
        let solution =
            solve_layout(&document, LogicalViewport { width: 640.0, height: 480.0 }).expect("solve");
        assert!(solution.views[0].visible);
        assert!(!solution.views[1].visible);
        assert_eq!(rect_of(&solution, "banner"), LogicalRect::new(0.0, 0.0, 640.0, 24.0));
    }

    #[test]
    fn default_layout_fills_the_window_with_the_first_view() {
        let document = default_layout_document("default");
        let solution =
            solve_layout(&document, LogicalViewport { width: 480.0, height: 320.0 }).expect("solve");
        assert_eq!(rect_of(&solution, "default"), LogicalRect::new(0.0, 0.0, 480.0, 320.0));
    }

    /// The pure face of native resize recompute (`windowDidResize` re-runs
    /// the same transaction against the live viewport): the stored document
    /// re-solves to the new geometry with no re-registration input.
    #[test]
    fn resize_recomputes_the_same_document_against_the_new_viewport() {
        let document: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [{
                "root": {
                    "dir": "column",
                    "children": [
                        { "id": "toolbar", "height": 44 },
                        { "id": "content", "flex": 1 }
                    ]
                }
            }]
        }))
        .expect("document");
        let initial = solve_layout(
            &document,
            LogicalViewport { width: 800.0, height: 600.0 },
        )
        .expect("solve");
        assert_eq!(rect_of(&initial, "content"), LogicalRect::new(0.0, 44.0, 800.0, 556.0));
        let resized = solve_layout(
            &document,
            LogicalViewport { width: 1024.0, height: 768.0 },
        )
        .expect("solve");
        assert_eq!(rect_of(&resized, "toolbar"), LogicalRect::new(0.0, 0.0, 1024.0, 44.0));
        assert_eq!(rect_of(&resized, "content"), LogicalRect::new(0.0, 44.0, 1024.0, 724.0));
    }

    /// The solve face of "layout replacement never rebuilds a webview
    /// context": a replacement document takes over verbatim (no merge with
    /// the previous one), and a view the new document no longer references
    /// solves to *no position* — the native transaction hides such a view
    /// and keeps its browsing context alive; nothing here removes it.
    #[test]
    fn layout_replacement_re_solves_verbatim_and_hides_unreferenced_views() {
        let mut state = WindowLayoutState::default();
        state.document = Some(
            serde_json::from_value(json!({
                "layers": [{
                    "root": {
                        "dir": "row",
                        "children": [{ "id": "sidebar", "width": 240 }, { "id": "editor", "flex": 1 }]
                    }
                }]
            }))
            .expect("initial document"),
        );
        let initial = solve_layout(
            &state.document.as_ref().unwrap(),
            LogicalViewport { width: 1024.0, height: 768.0 },
        )
        .expect("solve");
        assert_eq!(rect_of(&initial, "editor"), LogicalRect::new(240.0, 0.0, 784.0, 768.0));

        // A replacement document referencing only `sidebar` takes over
        // verbatim: `editor` is absent (hidden, not destroyed) and the
        // remaining view stretches to the full window.
        let replacement: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [{ "root": { "id": "sidebar", "flex": 1 } }]
        }))
        .expect("replacement");
        state.document = Some(replacement);
        let replaced = solve_layout(
            &state.effective_document(Some("sidebar")),
            LogicalViewport { width: 1024.0, height: 768.0 },
        )
        .expect("solve");
        assert_eq!(rect_of(&replaced, "sidebar"), LogicalRect::new(0.0, 0.0, 1024.0, 768.0));
        assert!(replaced.rect_for("editor").is_none());
    }

    #[test]
    fn validated_solve_rejects_before_solving() {
        let document: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [{ "root": { "dir": "column", "children": [{ "id": "sidebar" }] } }]
        }))
        .expect("document");
        let error = validated_solve(
            &document,
            &|id| matches!(id, "toolbar" | "content"),
            LogicalViewport { width: 800.0, height: 600.0 },
        )
        .expect_err("unknown view");
        assert_eq!(error.code(), OrchestrationErrorCode::UnknownView);

        let document: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [{ "root": { "id": "content", "width": -1 } }]
        }))
        .expect("document");
        let error = validated_solve(
            &document,
            &|id| matches!(id, "toolbar" | "content"),
            LogicalViewport { width: 800.0, height: 600.0 },
        )
        .expect_err("invalid measure");
        assert_eq!(error.code(), OrchestrationErrorCode::InvalidLayoutMeasure);

        // Box ids declared by the document itself are valid references.
        let document: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [
                { "root": { "id": "content", "flex": 1 } },
                { "root": { "kind": "box", "id": "ring", "border": { "width": 2, "color": "#333333AA" } } }
            ]
        }))
        .expect("document");
        assert!(validated_solve(
            &document,
            &|id| matches!(id, "toolbar" | "content"),
            LogicalViewport { width: 800.0, height: 600.0 },
        )
        .is_ok());
    }

    #[test]
    fn sizing_patch_merges_incrementally_and_reports_unknown_ids() {
        let mut document: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [{
                "root": {
                    "dir": "column",
                    "children": [
                        { "id": "toolbar", "height": 44 },
                        { "id": "content", "flex": 1 }
                    ]
                }
            }]
        }))
        .expect("document");
        assert!(apply_sizing_patch(
            &mut document,
            "toolbar",
            &WebviewLayoutSizing {
                height: Some(48.0),
                min_height: Some(32.0),
                ..WebviewLayoutSizing::default()
            }
        ));
        let solution =
            solve_layout(&document, LogicalViewport { width: 800.0, height: 600.0 }).expect("solve");
        assert_eq!(rect_of(&solution, "toolbar"), LogicalRect::new(0.0, 0.0, 800.0, 48.0));
        // Absent patch fields keep current values (null = no change).
        let WebviewLayoutNode::Container(root) = &document.layers[0].root else {
            panic!("container root");
        };
        let WebviewLayoutNode::WebviewView(toolbar) = &root.children[0] else {
            panic!("toolbar view");
        };
        assert_eq!(toolbar.sizing.height, Some(48.0));
        assert_eq!(toolbar.sizing.min_height, Some(32.0));
        assert_eq!(toolbar.sizing.width, None);

        assert!(!apply_sizing_patch(
            &mut document,
            "ghost",
            &WebviewLayoutSizing {
                height: Some(10.0),
                ..WebviewLayoutSizing::default()
            }
        ));
    }

    #[test]
    fn overlay_projection_covers_intersect_partial_and_empty_cases() {
        let safe = LogicalRect::new(78.0, 0.0, 722.0, 44.0);
        let full = LogicalRect::new(0.0, 0.0, 800.0, 600.0);
        // Full-window view: exactly the window-level values (regression).
        assert_eq!(project_overlay_safe_area(safe, full), Some(safe));
        // Partial intersection: clipped and translated into view-local space.
        let right_pane = LogicalRect::new(400.0, 0.0, 400.0, 600.0);
        assert_eq!(
            project_overlay_safe_area(safe, right_pane),
            Some(LogicalRect::new(0.0, 0.0, 400.0, 44.0))
        );
        let below = LogicalRect::new(0.0, 44.0, 800.0, 556.0);
        assert_eq!(project_overlay_safe_area(safe, below), None);
        // View moved down 20 logical px: the same window-level strip now
        // yields a shifted, clipped local rect (spec scenario).
        let moved = LogicalRect::new(0.0, 20.0, 800.0, 44.0);
        assert_eq!(
            project_overlay_safe_area(safe, moved),
            Some(LogicalRect::new(78.0, 0.0, 722.0, 24.0))
        );
    }

    #[test]
    fn drag_region_translation_moves_view_local_rects_into_window_space() {
        let view = LogicalRect::new(240.0, 44.0, 560.0, 556.0);
        let local = LogicalRect::new(0.0, 0.0, 200.0, 28.0);
        assert_eq!(
            translate_drag_region(view, local),
            LogicalRect::new(240.0, 44.0, 200.0, 28.0)
        );
    }
}
