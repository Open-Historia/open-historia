#![allow(dead_code)]

use ohfronts::sim::js::{self, Obj, Typed, Val};
use std::cell::{Cell, RefCell};

pub struct Case {
    pub args: Vec<Val>,
    pub result: Option<Val>,
    pub after: Option<Vec<Val>>,
    pub throws: Option<String>,
    pub callbacks: Vec<(String, Vec<(Vec<Val>, Val)>)>,
    pub result_calls: Vec<(Vec<Val>, Val)>,
    pub method_calls: Vec<(String, Vec<(Vec<Val>, Val)>)>,
    pub method_log: Vec<(String, Vec<Val>, Val)>,
}

impl Case {
    pub fn methods(&self, name: &str) -> &[(Vec<Val>, Val)] {
        self.method_calls.iter().find(|(key, _)| key == name).map(|(_, calls)| calls.as_slice()).unwrap_or(&[])
    }

    pub fn replay<F: Fn(&[Val]) -> Val>(calls: &[(Vec<Val>, Val)], call: F) -> Result<(), String> {
        for (index, (args, want)) in calls.iter().enumerate() {
            same(&call(args), want).map_err(|error| format!("call {index} {}: {error}", short(&Val::Arr(args.clone()))))?;
        }
        Ok(())
    }

    pub fn arg(&self, index: usize) -> &Val {
        self.args.get(index).unwrap_or(&js::UNDEF)
    }

    pub fn calls(&self, name: &str) -> Option<&Vec<(Vec<Val>, Val)>> {
        self.callbacks.iter().find(|(key, _)| key == name).map(|(_, calls)| calls)
    }
}

enum J {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

impl J {
    fn get(&self, key: &str) -> Option<&J> {
        match self {
            J::Obj(entries) => entries.iter().find(|(name, _)| name == key).map(|(_, value)| value),
            _ => None,
        }
    }

    fn list(&self) -> &[J] {
        match self {
            J::Arr(list) => list,
            _ => &[],
        }
    }

    fn text(&self) -> &str {
        match self {
            J::Str(text) => text,
            _ => "",
        }
    }

    fn number(&self) -> f64 {
        match self {
            J::Num(n) => *n,
            _ => f64::NAN,
        }
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Parser<'a> {
    fn space(&mut self) {
        while self.at < self.bytes.len() && matches!(self.bytes[self.at], b' ' | b'\n' | b'\r' | b'\t') {
            self.at += 1;
        }
    }

    fn value(&mut self) -> J {
        self.space();
        match self.bytes[self.at] {
            b'{' => {
                self.at += 1;
                let mut entries = Vec::new();
                loop {
                    self.space();
                    if self.bytes[self.at] == b'}' {
                        self.at += 1;
                        break;
                    }
                    let key = self.string();
                    self.space();
                    self.at += 1;
                    let value = self.value();
                    entries.push((key, value));
                    self.space();
                    if self.bytes[self.at] == b',' {
                        self.at += 1;
                    }
                }
                J::Obj(entries)
            }
            b'[' => {
                self.at += 1;
                let mut list = Vec::new();
                loop {
                    self.space();
                    if self.bytes[self.at] == b']' {
                        self.at += 1;
                        break;
                    }
                    list.push(self.value());
                    self.space();
                    if self.bytes[self.at] == b',' {
                        self.at += 1;
                    }
                }
                J::Arr(list)
            }
            b'"' => J::Str(self.string()),
            b't' => {
                self.at += 4;
                J::Bool(true)
            }
            b'f' => {
                self.at += 5;
                J::Bool(false)
            }
            b'n' => {
                self.at += 4;
                J::Null
            }
            _ => {
                let start = self.at;
                while self.at < self.bytes.len() && matches!(self.bytes[self.at], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E') {
                    self.at += 1;
                }
                J::Num(std::str::from_utf8(&self.bytes[start..self.at]).unwrap().parse::<f64>().unwrap())
            }
        }
    }

    fn hex(&mut self) -> u16 {
        let digits = std::str::from_utf8(&self.bytes[self.at..self.at + 4]).unwrap();
        self.at += 4;
        u16::from_str_radix(digits, 16).unwrap()
    }

    fn string(&mut self) -> String {
        self.at += 1;
        let mut units: Vec<u16> = Vec::new();
        loop {
            let byte = self.bytes[self.at];
            if byte == b'"' {
                self.at += 1;
                break;
            }
            if byte == b'\\' {
                self.at += 1;
                let escape = self.bytes[self.at];
                self.at += 1;
                let unit = match escape {
                    b'n' => 10,
                    b't' => 9,
                    b'r' => 13,
                    b'b' => 8,
                    b'f' => 12,
                    b'u' => self.hex(),
                    other => other as u16,
                };
                units.push(unit);
                continue;
            }
            let start = self.at;
            while self.at < self.bytes.len() && self.bytes[self.at] != b'"' && self.bytes[self.at] != b'\\' {
                self.at += 1;
            }
            units.extend(std::str::from_utf8(&self.bytes[start..self.at]).unwrap().encode_utf16());
        }
        String::from_utf16_lossy(&units)
    }
}

fn base64(text: &str) -> Vec<u8> {
    let value = |byte: u8| -> u32 {
        match byte {
            b'A'..=b'Z' => (byte - b'A') as u32,
            b'a'..=b'z' => (byte - b'a') as u32 + 26,
            b'0'..=b'9' => (byte - b'0') as u32 + 52,
            b'+' => 62,
            _ => 63,
        }
    };
    let clean: Vec<u8> = text.bytes().filter(|&b| b != b'=').collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut bits = 0u32;
        for (at, &byte) in chunk.iter().enumerate() {
            bits |= value(byte) << (18 - 6 * at);
        }
        out.push((bits >> 16) as u8);
        if chunk.len() > 2 {
            out.push((bits >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(bits as u8);
        }
    }
    out
}

struct Reader<'a> {
    blobs: &'a [J],
    cache: RefCell<Vec<Option<Val>>>,
}

impl<'a> Reader<'a> {
    fn val(&self, value: &J) -> Val {
        match value {
            J::Null => Val::Null,
            J::Bool(flag) => Val::Bool(*flag),
            J::Num(n) => Val::Num(*n),
            J::Str(text) => Val::Str(text.clone()),
            J::Arr(list) => Val::Arr(list.iter().map(|item| self.val(item)).collect()),
            J::Obj(entries) => {
                if let Some(J::Str(tag)) = value.get("$") {
                    return self.tagged(tag, value);
                }
                let mut out = Obj::new();
                for (key, item) in entries {
                    out.set(key, self.val(item));
                }
                Val::Obj(out)
            }
        }
    }

    fn numbers(&self, value: Option<&J>) -> Vec<f64> {
        value
            .map(|v| v.list())
            .unwrap_or(&[])
            .iter()
            .map(|item| match self.val(item) {
                Val::Num(n) => n,
                _ => f64::NAN,
            })
            .collect()
    }

    fn raw<'b>(&'b self, node: &'b J) -> &'b J {
        let mut node = node;
        while let (Some(J::Str(tag)), Some(k)) = (node.get("$"), node.get("k")) {
            if tag != "ref" {
                break;
            }
            node = &self.blobs[k.number() as usize];
        }
        node
    }

    fn typed(&self, tag: &str, node: &J) -> Typed {
        if let Some(J::Str(packed)) = node.get("b") {
            let bytes = base64(packed);
            return match tag {
                "U8" => Typed::U8(bytes),
                "U8C" => Typed::U8C(bytes),
                "I8" => Typed::I8(bytes.iter().map(|&b| b as i8).collect()),
                "U16" => Typed::U16(bytes.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect()),
                "I16" => Typed::I16(bytes.chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()),
                "U32" => Typed::U32(bytes.chunks(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()),
                "I32" => Typed::I32(bytes.chunks(4).map(|c| i32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()),
                "F32" => Typed::F32(bytes.chunks(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()),
                _ => Typed::F64(bytes.chunks(8).map(|c| f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]])).collect()),
            };
        }
        let values: Vec<f64> = if let Some(runs) = node.get("r").map(|r| self.raw(r)) {
            let flat = self.numbers(Some(runs));
            let mut out = Vec::new();
            for pair in flat.chunks(2) {
                for _ in 0..pair[1] as usize {
                    out.push(pair[0]);
                }
            }
            out
        } else {
            self.numbers(node.get("v").map(|v| self.raw(v)))
        };
        match tag {
            "U8" => Typed::U8(values.iter().map(|&n| n as u8).collect()),
            "U8C" => Typed::U8C(values.iter().map(|&n| n as u8).collect()),
            "I8" => Typed::I8(values.iter().map(|&n| n as i8).collect()),
            "U16" => Typed::U16(values.iter().map(|&n| n as u16).collect()),
            "I16" => Typed::I16(values.iter().map(|&n| n as i16).collect()),
            "U32" => Typed::U32(values.iter().map(|&n| n as u32).collect()),
            "I32" => Typed::I32(values.iter().map(|&n| n as i32).collect()),
            "F32" => Typed::F32(values.iter().map(|&n| n as f32).collect()),
            _ => Typed::F64(values),
        }
    }

    fn tagged(&self, tag: &str, node: &J) -> Val {
        let v = node.get("v").map(|v| self.raw(v));
        match tag {
            "u" => Val::Undef,
            "NaN" => Val::Num(f64::NAN),
            "Inf" => Val::Num(f64::INFINITY),
            "-Inf" => Val::Num(f64::NEG_INFINITY),
            "-0" => Val::Num(-0.0),
            "fn" | "cyc" => Val::Fn,
            "S16" => {
                let units: Vec<u16> = v.unwrap().list().iter().map(|item| item.number() as u16).collect();
                Val::Str(String::from_utf16_lossy(&units))
            }
            "ref" => {
                let index = node.get("k").unwrap().number() as usize;
                if let Some(done) = &self.cache.borrow()[index] {
                    return done.clone();
                }
                let made = self.val(&self.blobs[index]);
                self.cache.borrow_mut()[index] = Some(made.clone());
                made
            }
            "Map" => Val::Map(v.unwrap().list().iter().map(|pair| self.raw(pair)).map(|pair| (self.val(&pair.list()[0]), self.val(&pair.list()[1]))).collect()),
            "Set" => Val::Set(v.unwrap().list().iter().map(|item| self.val(item)).collect()),
            "O" => {
                let mut out = Obj::new();
                if let Some(J::Obj(entries)) = v {
                    for (key, item) in entries {
                        out.set(key, self.val(item));
                    }
                }
                Val::Obj(out)
            }
            "made" => {
                let mut out = match v.map(|v| self.val(v)) {
                    Some(Val::Obj(obj)) => obj,
                    _ => Obj::new(),
                };
                out.set("$made", Val::Str(node.get("by").map(|by| by.text()).unwrap_or("").to_string()));
                out.set("$args", node.get("a").map(|a| self.val(a)).unwrap_or(Val::Null));
                Val::Obj(out)
            }
            "U8" | "U8C" | "I8" | "U16" | "I16" | "U32" | "I32" | "F32" | "F64" => Val::Typed(self.typed(tag, node)),
            other => panic!("unknown tag {other}"),
        }
    }
}

pub struct Fixture {
    pub cases: Vec<(String, Vec<Case>)>,
}

fn as_list(value: Val) -> Vec<Val> {
    match value {
        Val::Arr(list) => list,
        other => vec![other],
    }
}

pub fn load(name: &str) -> Fixture {
    let path = format!("{}/tests/golden/{}.json", env!("CARGO_MANIFEST_DIR"), name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing {path}"));
    let root = Parser { bytes: text.as_bytes(), at: 0 }.value();
    let blobs = root.get("blobs").map(|b| b.list()).unwrap_or(&[]);
    let reader = Reader { cache: RefCell::new(vec![None; blobs.len()]), blobs };
    let mut cases = Vec::new();
    if let Some(J::Obj(entries)) = root.get("cases") {
        for (fn_name, list) in entries {
            let parsed = list
                .list()
                .iter()
                .map(|item| {
                    let calls_of = |calls: &J| -> Vec<(Vec<Val>, Val)> { calls.list().iter().map(|call| (as_list(reader.val(&call.list()[0])), reader.val(&call.list()[1]))).collect() };
                    let named = |key: &str| match item.get(key) {
                        Some(J::Obj(map)) => map.iter().map(|(name, calls)| (name.clone(), calls_of(calls))).collect(),
                        _ => Vec::new(),
                    };
                    Case {
                        args: item.get("a").map(|a| as_list(reader.val(a))).unwrap_or_default(),
                        result: item.get("r").map(|value| reader.val(value)),
                        after: item.get("aa").map(|a| as_list(reader.val(a))),
                        throws: item.get("x").map(|value| value.text().to_string()),
                        callbacks: named("cb"),
                        result_calls: item.get("rc").map(calls_of).unwrap_or_default(),
                        method_calls: named("mc"),
                        method_log: item.get("ml").map(|log| log.list().iter().map(|entry| (entry.list()[0].text().to_string(), as_list(reader.val(&entry.list()[1])), reader.val(&entry.list()[2]))).collect()).unwrap_or_default(),
                    }
                })
                .collect();
            cases.push((fn_name.clone(), parsed));
        }
    }
    Fixture { cases }
}

fn hidden(key: &str) -> bool {
    key.starts_with('$')
}

pub fn same(got: &Val, want: &Val) -> Result<(), String> {
    same_at(got, want, "")
}

fn same_number(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

fn same_at(got: &Val, want: &Val, at: &str) -> Result<(), String> {
    let fail = || Err(format!("at `{at}`: got {} want {}", short(got), short(want)));
    match (got, want) {
        (Val::Undef, Val::Undef) | (Val::Null, Val::Null) | (Val::Fn, Val::Fn) => Ok(()),
        (Val::Bool(a), Val::Bool(b)) if a == b => Ok(()),
        (Val::Num(a), Val::Num(b)) if same_number(*a, *b) => Ok(()),
        (Val::Str(a), Val::Str(b)) if a == b => Ok(()),
        (Val::Arr(a), Val::Arr(b)) | (Val::Set(a), Val::Set(b)) => {
            if a.len() != b.len() {
                return Err(format!("at `{at}`: length {} want {}", a.len(), b.len()));
            }
            for (index, (x, y)) in a.iter().zip(b).enumerate() {
                same_at(x, y, &format!("{at}[{index}]"))?;
            }
            Ok(())
        }
        (Val::Map(a), Val::Map(b)) => {
            if a.len() != b.len() {
                return Err(format!("at `{at}`: map size {} want {}", a.len(), b.len()));
            }
            for (index, ((ka, va), (kb, vb))) in a.iter().zip(b).enumerate() {
                same_at(ka, kb, &format!("{at}<key {index}>"))?;
                same_at(va, vb, &format!("{at}<{}>", js::to_string(kb)))?;
            }
            Ok(())
        }
        (Val::Typed(a), Val::Typed(b)) => {
            if a.tag() != b.tag() {
                return Err(format!("at `{at}`: typed {} want {}", a.tag(), b.tag()));
            }
            if a.len() != b.len() {
                return Err(format!("at `{at}`: length {} want {}", a.len(), b.len()));
            }
            for index in 0..a.len() {
                if !same_number(a.at(index), b.at(index)) {
                    return Err(format!("at `{at}[{index}]`: got {:e} want {:e}", a.at(index), b.at(index)));
                }
            }
            Ok(())
        }
        (Val::Obj(a), Val::Obj(b)) => {
            for (key, value) in b.entries() {
                if hidden(key) {
                    continue;
                }
                let mine = a.get(key).unwrap_or(&js::UNDEF);
                if matches!(value, Val::Fn) && mine.is_undef() {
                    continue;
                }
                same_at(mine, value, &format!("{at}.{key}"))?;
            }
            for (key, value) in a.entries() {
                if !hidden(key) && !b.has(key) && !value.is_undef() {
                    return Err(format!("at `{at}.{key}`: extra {}", short(value)));
                }
            }
            Ok(())
        }
        _ => fail(),
    }
}

pub fn short(value: &Val) -> String {
    let text = format!("{value:?}");
    if text.len() > 300 {
        format!("{}...", &text[..300])
    } else {
        text
    }
}

pub type Check<'a> = &'a dyn Fn(&Case) -> Option<Result<(), String>>;

pub fn expect(case: &Case, got: Val) -> Option<Result<(), String>> {
    match &case.result {
        Some(want) => Some(same(&got, want)),
        None => None,
    }
}

pub fn expect_after(case: &Case, index: usize, got: &Val) -> Result<(), String> {
    match &case.after {
        Some(after) => same(got, &after[index]).map_err(|error| format!("arg {index} after: {error}")),
        None => same(got, &case.args[index]).map_err(|error| format!("arg {index} unchanged: {error}")),
    }
}

pub fn run(module: &str, checks: &[(&str, Check)]) {
    let fixture = load(module);
    let mut failures = Vec::new();
    let mut report = Vec::new();
    for (fn_name, cases) in &fixture.cases {
        let check = match checks.iter().find(|(name, _)| name == fn_name) {
            Some((_, check)) => check,
            None => {
                failures.push(format!("{module}.{fn_name}: no check"));
                continue;
            }
        };
        let (mut passed, mut skipped, mut failed) = (0, 0, 0);
        for (index, case) in cases.iter().enumerate() {
            if case.throws.is_some() {
                skipped += 1;
                continue;
            }
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(case))) {
                Ok(None) => skipped += 1,
                Ok(Some(Ok(()))) => passed += 1,
                Ok(Some(Err(error))) => {
                    failed += 1;
                    if failures.len() < 40 {
                        failures.push(format!("{module}.{fn_name}#{index}: {error}"));
                    }
                }
                Err(_) => {
                    failed += 1;
                    if failures.len() < 40 {
                        failures.push(format!("{module}.{fn_name}#{index}: panicked"));
                    }
                }
            }
        }
        report.push(format!("{fn_name} {passed}/{} skipped {skipped} failed {failed}", cases.len()));
        if failed > 0 && failures.len() >= 40 {
            failures.push(format!("{module}.{fn_name}: {failed} failed"));
        }
    }
    println!("{module}: {}", report.join(", "));
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

pub struct Script<'a> {
    calls: Option<&'a Vec<(Vec<Val>, Val)>>,
    next: Cell<usize>,
    wrong: RefCell<Option<String>>,
}

impl<'a> Script<'a> {
    pub fn new(case: &'a Case, name: &str) -> Self {
        Script { calls: case.calls(name), next: Cell::new(0), wrong: RefCell::new(None) }
    }

    pub fn call(&self, args: &[Val]) -> Val {
        let at = self.next.get();
        self.next.set(at + 1);
        let calls = match self.calls {
            Some(calls) => calls,
            None => {
                self.wrong.borrow_mut().get_or_insert_with(|| "callback called but never recorded".into());
                return Val::Undef;
            }
        };
        match calls.get(at) {
            Some((want, result)) => {
                let got = Val::Arr(args.to_vec());
                let wanted = Val::Arr(want.clone());
                if let Err(error) = same(&got, &wanted) {
                    self.wrong.borrow_mut().get_or_insert_with(|| format!("callback call {at}: {error}"));
                }
                result.clone()
            }
            None => {
                self.wrong.borrow_mut().get_or_insert_with(|| format!("callback called {} times, recorded {}", at + 1, calls.len()));
                Val::Undef
            }
        }
    }

    pub fn done(&self) -> Result<(), String> {
        if let Some(error) = self.wrong.borrow().clone() {
            return Err(error);
        }
        let recorded = self.calls.map(|calls| calls.len()).unwrap_or(0);
        if self.next.get() != recorded {
            return Err(format!("callback called {} times, recorded {}", self.next.get(), recorded));
        }
        Ok(())
    }
}

pub fn num(value: f64) -> Val {
    Val::Num(value)
}

pub fn text(value: &str) -> Val {
    Val::Str(value.to_string())
}

pub fn opt_num(value: Option<f64>) -> Val {
    value.map(Val::Num).unwrap_or(Val::Null)
}

pub fn nums(values: &[f64]) -> Val {
    Val::nums(values)
}

pub fn u8s(values: Vec<u8>) -> Val {
    Val::Typed(Typed::U8(values))
}

pub fn i8s(values: Vec<i8>) -> Val {
    Val::Typed(Typed::I8(values))
}

pub fn i32s(values: Vec<i32>) -> Val {
    Val::Typed(Typed::I32(values))
}

pub fn f64s(values: Vec<f64>) -> Val {
    Val::Typed(Typed::F64(values))
}

pub fn list(values: Vec<Val>) -> Val {
    Val::Arr(values)
}

pub fn arg_text(value: &Val) -> String {
    value.string_or_empty()
}

pub fn arg_bytes(value: &Val) -> Vec<u8> {
    match value {
        Val::Typed(typed) => typed.values().iter().map(|&n| js::to_int32(n) as u8).collect(),
        Val::Arr(list) => list.iter().map(|item| js::to_int32(item.num()) as u8).collect(),
        _ => Vec::new(),
    }
}

pub fn arg_numbers(value: &Val) -> Vec<f64> {
    match value {
        Val::Typed(typed) => typed.values(),
        Val::Arr(list) => list.iter().map(|item| item.num()).collect(),
        _ => Vec::new(),
    }
}

pub fn arg_is_number(value: &Val) -> bool {
    matches!(value, Val::Num(_))
}

pub fn same_keys(got: &Val, want: &Val, keys: &[&str]) -> Result<(), String> {
    for key in keys {
        same(got.get(key), want.get(key)).map_err(|error| format!(".{key}: {error}"))?;
    }
    Ok(())
}

pub fn expect_keys(case: &Case, got: Val, keys: &[&str]) -> Option<Result<(), String>> {
    case.result.as_ref().map(|want| same_keys(&got, want, keys))
}
