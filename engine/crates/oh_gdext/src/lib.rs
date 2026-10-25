use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, TryRecvError};
use std::sync::Arc;
use std::thread;

use godot::prelude::*;
use ohmap::{BakedMap, PickIndex};

struct OpenHistoriaExtension;

#[gdextension]
unsafe impl ExtensionLibrary for OpenHistoriaExtension {}

enum SidecarOutput {
    Line(String),
    Diagnostic(String),
    Closed,
}

#[derive(GodotClass)]
#[class(base = Node)]
pub struct Sidecar {
    base: Base<Node>,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    output: Option<Receiver<SidecarOutput>>,
    open_streams: u8,
}

#[godot_api]
impl INode for Sidecar {
    fn init(base: Base<Node>) -> Self {
        Self { base, child: None, stdin: None, output: None, open_streams: 0 }
    }

    fn process(&mut self, _delta: f64) {
        let mut lines = Vec::new();
        let mut diagnostics = Vec::new();
        let mut closed = 0u8;
        if let Some(output) = &self.output {
            for _ in 0..512 {
                match output.try_recv() {
                    Ok(SidecarOutput::Line(line)) => lines.push(line),
                    Ok(SidecarOutput::Diagnostic(line)) => diagnostics.push(line),
                    Ok(SidecarOutput::Closed) => closed += 1,
                    Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
                }
            }
        }
        for line in lines {
            self.signals().message().emit(&GString::from(line.as_str()));
        }
        for line in diagnostics {
            self.signals().diagnostic().emit(&GString::from(line.as_str()));
        }
        if closed > 0 {
            self.open_streams = self.open_streams.saturating_sub(closed);
            if self.open_streams == 0 && self.child.is_some() {
                let code = self.child.as_mut().and_then(|child| child.wait().ok()).and_then(|status| status.code()).unwrap_or(-1);
                self.child = None;
                self.stdin = None;
                self.output = None;
                self.signals().exited().emit(code as i64);
            }
        }
    }

    fn exit_tree(&mut self) {
        self.stop();
    }
}

#[godot_api]
impl Sidecar {
    #[signal]
    fn message(line: GString);

    #[signal]
    fn diagnostic(line: GString);

    #[signal]
    fn exited(code: i64);

    #[func]
    fn start(&mut self, program: GString, arguments: PackedStringArray, working_directory: GString, environment: VarDictionary) -> bool {
        if self.child.is_some() {
            return true;
        }
        let mut command = Command::new(program.to_string());
        for argument in arguments.as_slice() {
            command.arg(argument.to_string());
        }
        let directory = working_directory.to_string();
        if !directory.is_empty() {
            command.current_dir(directory);
        }
        for (key, value) in environment.iter_shared() {
            command.env(key.to_string(), value.to_string());
        }
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                godot_error!("The game engine could not be started: {error}");
                return false;
            }
        };
        let (sender, receiver) = channel();
        if let Some(stdout) = child.stdout.take() {
            let sender = sender.clone();
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    match line {
                        Ok(line) => {
                            if sender.send(SidecarOutput::Line(line)).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let _ = sender.send(SidecarOutput::Closed);
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let sender = sender.clone();
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    match line {
                        Ok(line) => {
                            if sender.send(SidecarOutput::Diagnostic(line)).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let _ = sender.send(SidecarOutput::Closed);
            });
        }
        self.stdin = child.stdin.take();
        self.child = Some(child);
        self.output = Some(receiver);
        self.open_streams = 2;
        true
    }

    #[func]
    fn send(&mut self, line: GString) -> bool {
        let Some(stdin) = self.stdin.as_mut() else {
            return false;
        };
        let mut text = line.to_string();
        text.push('\n');
        stdin.write_all(text.as_bytes()).and_then(|_| stdin.flush()).is_ok()
    }

    #[func]
    fn is_running(&self) -> bool {
        self.child.is_some()
    }

    #[func]
    fn stop(&mut self) {
        self.stdin = None;
        if let Some(mut child) = self.child.take() {
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) if std::time::Instant::now() < deadline => thread::sleep(std::time::Duration::from_millis(25)),
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                }
            }
        }
        self.output = None;
        self.open_streams = 0;
    }
}

type BakeResult = Result<(BakedMap, PickIndex), String>;

#[derive(GodotClass)]
#[class(base = Node)]
pub struct MapBaker {
    base: Base<Node>,
    pending: Option<Receiver<BakeResult>>,
    index: Option<Arc<PickIndex>>,
}

#[godot_api]
impl INode for MapBaker {
    fn init(base: Base<Node>) -> Self {
        Self { base, pending: None, index: None }
    }

    fn process(&mut self, _delta: f64) {
        let Some(pending) = &self.pending else {
            return;
        };
        let outcome = match pending.try_recv() {
            Ok(outcome) => outcome,
            Err(TryRecvError::Empty) => return,
            Err(TryRecvError::Disconnected) => Err("The map builder stopped unexpectedly.".to_string()),
        };
        self.pending = None;
        match outcome {
            Ok((map, index)) => {
                self.index = Some(Arc::new(index));
                let result = to_dictionary(&map);
                self.signals().baked().emit(&result);
            }
            Err(message) => {
                self.signals().failed().emit(&GString::from(message.as_str()));
            }
        }
    }
}

#[godot_api]
impl MapBaker {
    #[signal]
    fn baked(result: VarDictionary);

    #[signal]
    fn failed(message: GString);

    #[func]
    fn bake_file(&mut self, path: GString, width: f32) {
        let path = path.to_string();
        let (sender, receiver) = channel();
        self.pending = Some(receiver);
        self.index = None;
        thread::spawn(move || {
            let outcome = std::fs::read_to_string(&path)
                .map_err(|error| format!("The regions file could not be read: {error}"))
                .and_then(|text| ohmap::bake_geojson(&text, width))
                .map(|map| {
                    let index = PickIndex::new(&map, 512);
                    (map, index)
                });
            let _ = sender.send(outcome);
        });
    }

    #[func]
    fn is_baking(&self) -> bool {
        self.pending.is_some()
    }

    #[func]
    fn pick(&self, point: Vector2) -> i64 {
        self.index.as_ref().map(|index| index.pick(point.x, point.y) as i64).unwrap_or(-1)
    }
}

fn to_dictionary(map: &BakedMap) -> VarDictionary {
    let vertices: PackedVector2Array = map.vertices.iter().map(|p| Vector2::new(p[0], p[1])).collect();
    let uvs: PackedVector2Array = map.vertex_region.iter().map(|&region| Vector2::new(region as f32, 0.0)).collect();
    let indices: PackedInt32Array = map.indices.iter().map(|&value| value as i32).collect();
    let border_vertices: PackedVector2Array = map.border_vertices.iter().map(|p| Vector2::new(p[0], p[1])).collect();
    let border_uvs: PackedVector2Array = map
        .border_regions
        .iter()
        .flat_map(|pair| {
            let uv = Vector2::new(pair[0] as f32, pair[1] as f32);
            [uv, uv]
        })
        .collect();
    let adjacency: PackedInt32Array = map.adjacency.iter().flat_map(|pair| [pair[0] as i32, pair[1] as i32]).collect();
    let centroids: PackedVector2Array = map.centroids.iter().map(|p| Vector2::new(p[0], p[1])).collect();
    let areas: PackedFloat32Array = map.areas.iter().copied().collect();
    let ids: PackedStringArray = map.ids.iter().map(|id| GString::from(id.as_str())).collect();
    let names: PackedStringArray = map.names.iter().map(|name| GString::from(name.as_str())).collect();
    let mut result = VarDictionary::new();
    result.set(&"width".to_variant(), &(map.width).to_variant());
    result.set(&"ids".to_variant(), &(ids).to_variant());
    result.set(&"names".to_variant(), &(names).to_variant());
    result.set(&"vertices".to_variant(), &(vertices).to_variant());
    result.set(&"uvs".to_variant(), &(uvs).to_variant());
    result.set(&"indices".to_variant(), &(indices).to_variant());
    result.set(&"border_vertices".to_variant(), &(border_vertices).to_variant());
    result.set(&"border_uvs".to_variant(), &(border_uvs).to_variant());
    result.set(&"adjacency".to_variant(), &(adjacency).to_variant());
    result.set(&"centroids".to_variant(), &(centroids).to_variant());
    result.set(&"areas".to_variant(), &(areas).to_variant());
    result.set(&"bounds".to_variant(), &(Rect2::new(Vector2::new(map.bounds[0], map.bounds[1]), Vector2::new(map.bounds[2] - map.bounds[0], map.bounds[3] - map.bounds[1]))).to_variant());
    result
}
