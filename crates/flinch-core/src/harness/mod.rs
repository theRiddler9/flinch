use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub struct ErrorDetail {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
    pub traceback: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub struct ObjectStat {
    pub name: String,
    #[serde(rename = "type")]
    pub obj_type: String,
    pub has_animation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub struct CountsStat {
    pub mesh: u32,
    pub light: u32,
    pub camera: u32,
    pub grease_pencil: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub struct SceneStats {
    pub blender_version: String,
    pub objects: Vec<ObjectStat>,
    pub counts: CountsStat,
    #[ts(type = "[number, number]")]
    pub frame_range: (i32, i32),
    pub fps: u32,
    pub keyframe_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub struct CheckDetail {
    pub id: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub struct HarnessResult {
    pub schema: u32,
    pub ok: bool,
    pub stage: String,
    pub error: Option<ErrorDetail>,
    pub stdout: String,
    pub warnings: Vec<String>,
    pub scene_stats: SceneStats,
    pub checks: Vec<CheckDetail>,
    pub duration_ms: u32,
}

