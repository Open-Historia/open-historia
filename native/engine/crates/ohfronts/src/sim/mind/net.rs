use crate::jsmath;
use crate::sim::js::{self, Obj, Typed, Val};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shape {
    pub inputs: f64,
    pub hidden: f64,
    pub outputs: f64,
    pub head: f64,
    pub head_hidden: f64,
}

impl Shape {
    pub const fn side(inputs: usize, hidden: usize, outputs: usize) -> Shape {
        Shape { inputs: inputs as f64, hidden: hidden as f64, outputs: outputs as f64, head: f64::NAN, head_hidden: f64::NAN }
    }

    pub fn of(value: &Val) -> Shape {
        let read = |key: &str| if value.get(key).is_undef() { f64::NAN } else { value.get(key).num() };
        Shape { inputs: read("inputs"), hidden: read("hidden"), outputs: read("outputs"), head: read("head"), head_hidden: read("headHidden") }
    }

    fn has_head(&self) -> bool {
        self.head > 0.0
    }
}

pub struct Stepped {
    pub state: Vec<f64>,
    pub out: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Weights {
    pub shape: Shape,
    pub params: Vec<f64>,
    pub prior: f64,
    pub drafts: bool,
}

fn side_count(shape: &Shape) -> f64 {
    let Shape { inputs, hidden, outputs, .. } = *shape;
    2.0 * hidden * (inputs + hidden + 1.0) + outputs * (hidden + inputs + 1.0)
}

fn head_count(shape: &Shape) -> f64 {
    let head = if shape.head.is_nan() { 0.0 } else { shape.head };
    let head_hidden = if shape.head_hidden.is_nan() { 0.0 } else { shape.head_hidden };
    if head > 0.0 && head_hidden > 0.0 {
        head_hidden * (head + shape.hidden + 1.0) + shape.outputs * (head_hidden + 1.0)
    } else {
        0.0
    }
}

pub fn param_count(shape: &Shape) -> f64 {
    side_count(shape) + head_count(shape)
}

fn gate(value: f64) -> f64 {
    if value <= -2.0 {
        0.0
    } else if value >= 2.0 {
        1.0
    } else {
        0.25 * value + 0.5
    }
}

pub fn squash(value: f64) -> f64 {
    if value <= -1.0 {
        -1.0
    } else if value >= 1.0 {
        1.0
    } else {
        value
    }
}

fn at(list: &[f64], index: usize) -> f64 {
    list.get(index).copied().unwrap_or(f64::NAN)
}

pub fn blank_state(shape: &Shape) -> Vec<f64> {
    vec![0.0; shape.hidden as usize]
}

pub fn step(shape: &Shape, params: &[f64], state: &[f64], x: &[f64]) -> Stepped {
    let (inputs, hidden, outputs) = (shape.inputs as usize, shape.hidden as usize, shape.outputs as usize);
    let wide = inputs + hidden;
    let mut next = vec![0.0; hidden];
    let wc = hidden * wide + hidden;
    for unit in 0..hidden {
        let mut z = at(params, hidden * wide + unit);
        let mut c = at(params, wc + hidden * wide + unit);
        let row_z = unit * wide;
        let row_c = wc + unit * wide;
        for along in 0..inputs {
            z += at(params, row_z + along) * at(x, along);
            c += at(params, row_c + along) * at(x, along);
        }
        for along in 0..hidden {
            z += at(params, row_z + inputs + along) * at(state, along);
            c += at(params, row_c + inputs + along) * at(state, along);
        }
        let open = gate(z);
        next[unit] = (1.0 - open) * at(state, unit) + open * squash(c);
    }
    let wo = 2 * wc;
    let wx = wo + outputs * hidden;
    let bo = wx + outputs * inputs;
    let mut out = vec![0.0; outputs];
    for unit in 0..outputs {
        let mut sum = at(params, bo + unit);
        for along in 0..hidden {
            sum += at(params, wo + unit * hidden + along) * next[along];
        }
        for along in 0..inputs {
            sum += at(params, wx + unit * inputs + along) * at(x, along);
        }
        out[unit] = sum;
    }
    Stepped { state: next, out }
}

pub fn head_step(shape: &Shape, params: &[f64], state: &[f64], lean: Option<&[f64]>, t: &[f64]) -> Vec<f64> {
    let (hidden, outputs, head, head_hidden) = (shape.hidden as usize, shape.outputs as usize, shape.head as usize, shape.head_hidden as usize);
    let wide = head + hidden;
    let wu = side_count(shape) as usize;
    let bu = wu + head_hidden * wide;
    let wv = bu + head_hidden;
    let bv = wv + outputs * head_hidden;
    let mut unit = vec![0.0; head_hidden];
    for row in 0..head_hidden {
        let mut sum = at(params, bu + row);
        let at0 = wu + row * wide;
        for along in 0..head {
            sum += at(params, at0 + along) * at(t, along);
        }
        for along in 0..hidden {
            sum += at(params, at0 + head + along) * at(state, along);
        }
        unit[row] = squash(sum);
    }
    let mut scores = vec![0.0; outputs];
    for out in 0..outputs {
        let mut sum = at(params, bv + out) + lean.map(|lean| at(lean, out)).unwrap_or(0.0);
        for row in 0..head_hidden {
            sum += at(params, wv + out * head_hidden + row) * unit[row];
        }
        scores[out] = sum;
    }
    scores
}

fn shape_val(shape: &Shape, head_hidden: bool) -> Val {
    let mut out = Obj::new();
    out.set("inputs", Val::Num(shape.inputs));
    out.set("hidden", Val::Num(shape.hidden));
    out.set("outputs", Val::Num(shape.outputs));
    if head_hidden {
        out.set("head", Val::Num(shape.head));
        out.set("headHidden", if shape.head_hidden.is_nan() { Val::Undef } else { Val::Num(shape.head_hidden) });
    }
    Val::Obj(out)
}

pub fn pack_weights(shape: &Shape, params: &[f64], extra: &Val) -> Val {
    let mut out = Obj::new();
    out.set("shape", shape_val(shape, shape.has_head()));
    for (key, item) in js::entries(extra) {
        out.set(&key, item);
    }
    out.set("params", Val::Arr(params.iter().map(|&value| Val::Num(jsmath::round(value * 1e5) / 1e5)).collect()));
    Val::Obj(out)
}

pub fn weights_val(weights: &Weights) -> Val {
    let shape = &weights.shape;
    Val::obj([
        ("shape", shape_val(shape, shape.head > 0.0 && shape.head_hidden > 0.0)),
        ("params", Val::Typed(Typed::F64(weights.params.clone()))),
        ("prior", Val::Num(weights.prior)),
        ("drafts", Val::Bool(weights.drafts)),
    ])
}

pub fn read_weights(packed: &Val) -> Option<Weights> {
    let shape = packed.get("shape");
    if !shape.truthy() {
        return None;
    }
    let given = Shape::of(shape);
    if !(given.inputs > 0.0) || !(given.hidden > 0.0) || !(given.outputs > 0.0) {
        return None;
    }
    let headed = given.head > 0.0 && given.head_hidden > 0.0;
    let read = Shape { head: if headed { given.head } else { f64::NAN }, head_hidden: if headed { given.head_hidden } else { f64::NAN }, ..given };
    let params: Vec<f64> = match packed.get("params") {
        Val::Arr(list) => list.iter().map(js::to_number).collect(),
        _ => Vec::new(),
    };
    if params.len() as f64 != param_count(&read) {
        return None;
    }
    if params.iter().any(|value| !value.is_finite()) {
        return None;
    }
    let prior = js::to_number(packed.get("prior"));
    Some(Weights { shape: read, params, prior: if prior > 0.0 { prior } else { 0.0 }, drafts: packed.get("drafts").is_true() })
}
