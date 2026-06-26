use napi::{Error, Status};
use napi_derive::napi;

#[napi(object)]
pub struct VisibleRuntimeHostOptions {
    pub package_version: Option<String>,
    pub app_id: Option<String>,
    pub app_name: Option<String>,
    pub auto_exit_after_ms: Option<u32>,
}

#[napi]
pub struct VisibleRuntime;

#[napi]
impl VisibleRuntime {
    #[napi]
    pub fn request(&self, _frame_json: String) -> napi::Result<Vec<String>> {
        Err(unsupported_visible_runtime())
    }

    #[napi]
    pub fn poll_events(&self) -> napi::Result<Vec<String>> {
        Err(unsupported_visible_runtime())
    }

    #[napi]
    pub fn close(&self) -> napi::Result<Vec<String>> {
        Err(unsupported_visible_runtime())
    }
}

#[napi]
pub fn create_visible_runtime() -> napi::Result<VisibleRuntime> {
    Err(unsupported_visible_runtime())
}

#[napi]
pub fn run_visible_runtime_host(_options: Option<VisibleRuntimeHostOptions>) -> napi::Result<()> {
    Err(unsupported_visible_runtime())
}

fn unsupported_visible_runtime() -> Error {
    Error::new(
        Status::GenericFailure,
        "OpenTray visible Node runtime binding is not supported on this platform yet",
    )
}
