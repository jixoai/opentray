use opentray_spec::{ServerFrame, PROTOCOL_VERSION};

fn main() {
    let ready = ServerFrame::Ready {
        version: PROTOCOL_VERSION,
    };
    println!("{}", serde_json::to_string(&ready).expect("ready frame"));
}
