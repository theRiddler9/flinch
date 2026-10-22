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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rewritten_script: Option<String>,
}

/// Viewpoint used when rendering a preview frame (the harness `--view` argument).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub enum ViewPreset {
    /// The scene's own camera (reframed automatically if it does not show the subject).
    #[default]
    Camera,
    /// Orthographic front view.
    Front,
    /// Orthographic right-side view.
    Side,
    /// Orthographic top-down view.
    Top,
    /// Elevated 3/4 perspective view.
    Iso,
}

impl ViewPreset {
    pub fn as_arg(self) -> &'static str {
        match self {
            ViewPreset::Camera => "camera",
            ViewPreset::Front => "front",
            ViewPreset::Side => "side",
            ViewPreset::Top => "top",
            ViewPreset::Iso => "iso",
        }
    }
}

/// Shading style of a preview render (the harness `--shading` argument).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub enum ShadingMode {
    /// Workbench with cavity shading.
    #[default]
    Solid,
    /// Workbench wireframe overlay.
    Wireframe,
    /// Material preview with the configured render engine.
    Rendered,
}

impl ShadingMode {
    pub fn as_arg(self) -> &'static str {
        match self {
            ShadingMode::Solid => "solid",
            ShadingMode::Wireframe => "wireframe",
            ShadingMode::Rendered => "rendered",
        }
    }
}

/// Everything the harness needs to know to render a preview image.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PreviewOptions {
    pub view: ViewPreset,
    pub shading: ShadingMode,
    /// Engine preset (`workbench`, `eevee`, `cycles_fast`, `cycles_prod`); used by `Rendered` shading.
    pub engine: String,
    /// MatCap lighting in solid shading.
    pub matcap: bool,
    /// Output size in pixels; `None` keeps the harness default (640x360).
    pub size: Option<(u32, u32)>,
}

impl PreviewOptions {
    /// Harness command-line arguments for these options.
    pub fn to_args(&self) -> Vec<String> {
        let engine = match self.engine.trim() {
            "" => "workbench",
            e => e,
        };
        let mut args = vec![
            "--engine".to_string(),
            engine.to_string(),
            "--view".to_string(),
            self.view.as_arg().to_string(),
            "--shading".to_string(),
            self.shading.as_arg().to_string(),
        ];
        if self.matcap {
            args.push("--matcap".to_string());
        }
        if let Some((w, h)) = self.size {
            args.extend([
                "--width".into(),
                w.to_string(),
                "--height".into(),
                h.to_string(),
            ]);
        }
        args
    }
}

#[cfg(test)]
mod preview_tests {
    use super::*;

    #[test]
    fn view_and_shading_serialize_lowercase_and_match_as_arg() {
        for v in [
            ViewPreset::Camera,
            ViewPreset::Front,
            ViewPreset::Side,
            ViewPreset::Top,
            ViewPreset::Iso,
        ] {
            assert_eq!(
                serde_json::to_string(&v).unwrap(),
                format!("\"{}\"", v.as_arg())
            );
            assert_eq!(
                serde_json::from_str::<ViewPreset>(&format!("\"{}\"", v.as_arg())).unwrap(),
                v
            );
        }
        for m in [
            ShadingMode::Solid,
            ShadingMode::Wireframe,
            ShadingMode::Rendered,
        ] {
            assert_eq!(
                serde_json::to_string(&m).unwrap(),
                format!("\"{}\"", m.as_arg())
            );
        }
        assert!(serde_json::from_str::<ViewPreset>("\"sideways\"").is_err());
        assert_eq!(
            (ViewPreset::default(), ShadingMode::default()),
            (ViewPreset::Camera, ShadingMode::Solid)
        );
    }

    #[test]
    fn preview_args() {
        assert_eq!(
            PreviewOptions::default().to_args(),
            [
                "--engine",
                "workbench",
                "--view",
                "camera",
                "--shading",
                "solid"
            ]
        );
        let opts = PreviewOptions {
            view: ViewPreset::Top,
            shading: ShadingMode::Rendered,
            engine: "eevee".into(),
            matcap: true,
            size: Some((1920, 1080)),
        };
        assert_eq!(
            opts.to_args(),
            [
                "--engine",
                "eevee",
                "--view",
                "top",
                "--shading",
                "rendered",
                "--matcap",
                "--width",
                "1920",
                "--height",
                "1080"
            ]
        );
    }
}
