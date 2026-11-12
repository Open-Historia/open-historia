use ohfronts::sim::js::{self, Obj, Typed, Val};

pub fn parse(text: &str) -> Result<Val, String> {
    let mut reader = Reader { bytes: text.as_bytes(), at: 0 };
    let value = reader.value()?;
    reader.space();
    if reader.at != reader.bytes.len() {
        return Err(format!("text after the value at {}", reader.at));
    }
    Ok(value)
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn space(&mut self) {
        while self.at < self.bytes.len() && matches!(self.bytes[self.at], b' ' | b'\n' | b'\r' | b'\t') {
            self.at += 1;
        }
    }

    fn peek(&self) -> Result<u8, String> {
        self.bytes.get(self.at).copied().ok_or_else(|| "the text ends early".to_string())
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        if self.peek()? != byte {
            return Err(format!("expected '{}' at {}", byte as char, self.at));
        }
        self.at += 1;
        Ok(())
    }

    fn word(&mut self, word: &str) -> Result<(), String> {
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Ok(())
        } else {
            Err(format!("unknown word at {}", self.at))
        }
    }

    fn value(&mut self) -> Result<Val, String> {
        self.space();
        match self.peek()? {
            b'{' => self.object(),
            b'[' => {
                self.at += 1;
                let mut list = Vec::new();
                self.space();
                if self.peek()? == b']' {
                    self.at += 1;
                    return Ok(Val::Arr(list));
                }
                loop {
                    list.push(self.value()?);
                    self.space();
                    match self.peek()? {
                        b',' => self.at += 1,
                        b']' => {
                            self.at += 1;
                            return Ok(Val::Arr(list));
                        }
                        _ => return Err(format!("expected ',' or ']' at {}", self.at)),
                    }
                }
            }
            b'"' => Ok(Val::Str(self.string()?)),
            b't' => self.word("true").map(|_| Val::Bool(true)),
            b'f' => self.word("false").map(|_| Val::Bool(false)),
            b'n' => self.word("null").map(|_| Val::Null),
            _ => {
                let start = self.at;
                while self.at < self.bytes.len() && matches!(self.bytes[self.at], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E') {
                    self.at += 1;
                }
                let digits = std::str::from_utf8(&self.bytes[start..self.at]).map_err(|error| error.to_string())?;
                digits.parse::<f64>().map(Val::Num).map_err(|_| format!("not a number at {start}"))
            }
        }
    }

    fn object(&mut self) -> Result<Val, String> {
        self.at += 1;
        let mut entries: Vec<(String, Val)> = Vec::new();
        self.space();
        if self.peek()? == b'}' {
            self.at += 1;
            return Ok(Val::Obj(Obj(entries)));
        }
        loop {
            self.space();
            let key = self.string()?;
            self.space();
            self.expect(b':')?;
            let value = self.value()?;
            entries.push((key, value));
            self.space();
            match self.peek()? {
                b',' => self.at += 1,
                b'}' => {
                    self.at += 1;
                    break;
                }
                _ => return Err(format!("expected ',' or '}}' at {}", self.at)),
            }
        }
        match entries.iter().find(|(key, _)| key == "$") {
            Some((_, Val::Str(tag))) => tagged(&tag.clone(), entries),
            _ => Ok(Val::Obj(Obj(entries))),
        }
    }

    fn hex(&mut self) -> Result<u16, String> {
        let digits = self.bytes.get(self.at..self.at + 4).ok_or("the text ends in an escape")?;
        self.at += 4;
        u16::from_str_radix(std::str::from_utf8(digits).map_err(|error| error.to_string())?, 16).map_err(|error| error.to_string())
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let start = self.at;
        while self.at < self.bytes.len() && self.bytes[self.at] != b'"' && self.bytes[self.at] != b'\\' {
            self.at += 1;
        }
        if self.peek()? == b'"' {
            let text = std::str::from_utf8(&self.bytes[start..self.at]).map_err(|error| error.to_string())?.to_string();
            self.at += 1;
            return Ok(text);
        }
        let mut units: Vec<u16> = std::str::from_utf8(&self.bytes[start..self.at]).map_err(|error| error.to_string())?.encode_utf16().collect();
        loop {
            let byte = self.peek()?;
            if byte == b'"' {
                self.at += 1;
                break;
            }
            if byte == b'\\' {
                self.at += 1;
                let escape = self.peek()?;
                self.at += 1;
                units.push(match escape {
                    b'n' => 10,
                    b't' => 9,
                    b'r' => 13,
                    b'b' => 8,
                    b'f' => 12,
                    b'u' => self.hex()?,
                    other => other as u16,
                });
                continue;
            }
            let from = self.at;
            while self.at < self.bytes.len() && self.bytes[self.at] != b'"' && self.bytes[self.at] != b'\\' {
                self.at += 1;
            }
            units.extend(std::str::from_utf8(&self.bytes[from..self.at]).map_err(|error| error.to_string())?.encode_utf16());
        }
        Ok(String::from_utf16_lossy(&units))
    }
}

fn take(entries: &mut Vec<(String, Val)>, key: &str) -> Val {
    match entries.iter().position(|(name, _)| name == key) {
        Some(at) => entries.remove(at).1,
        None => Val::Undef,
    }
}

fn numbers(value: &Val) -> Vec<f64> {
    value.array_or_empty().iter().map(|item| match item {
        Val::Num(n) => *n,
        _ => f64::NAN,
    }).collect()
}

fn base64(text: &str) -> Vec<u8> {
    let value = |byte: u8| -> u32 {
        match byte {
            b'A'..=b'Z' => (byte - b'A') as u32,
            b'a'..=b'z' => (byte - b'a') as u32 + 26,
            b'0'..=b'9' => (byte - b'0') as u32 + 52,
            b'+' | b'-' => 62,
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

fn typed(tag: &str, entries: &mut Vec<(String, Val)>) -> Result<Typed, String> {
    if let Val::Str(packed) = take(entries, "b") {
        let bytes = base64(&packed);
        return Ok(match tag {
            "U8" => Typed::U8(bytes),
            "U8C" => Typed::U8C(bytes),
            "I8" => Typed::I8(bytes.iter().map(|&b| b as i8).collect()),
            "U16" => Typed::U16(bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect()),
            "I16" => Typed::I16(bytes.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()),
            "U32" => Typed::U32(bytes.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()),
            "I32" => Typed::I32(bytes.chunks_exact(4).map(|c| i32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()),
            "F32" => Typed::F32(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()),
            "F64" => Typed::F64(bytes.chunks_exact(8).map(|c| f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]])).collect()),
            other => return Err(format!("unknown typed array {other}")),
        });
    }
    let values = numbers(&take(entries, "v"));
    Ok(match tag {
        "U8" => Typed::U8(values.iter().map(|&n| n as u8).collect()),
        "U8C" => Typed::U8C(values.iter().map(|&n| n as u8).collect()),
        "I8" => Typed::I8(values.iter().map(|&n| n as i8).collect()),
        "U16" => Typed::U16(values.iter().map(|&n| n as u16).collect()),
        "I16" => Typed::I16(values.iter().map(|&n| n as i16).collect()),
        "U32" => Typed::U32(values.iter().map(|&n| n as u32).collect()),
        "I32" => Typed::I32(values.iter().map(|&n| n as i32).collect()),
        "F32" => Typed::F32(values.iter().map(|&n| n as f32).collect()),
        "F64" => Typed::F64(values),
        other => return Err(format!("unknown typed array {other}")),
    })
}

fn tagged(tag: &str, mut entries: Vec<(String, Val)>) -> Result<Val, String> {
    Ok(match tag {
        "u" => Val::Undef,
        "NaN" => Val::Num(f64::NAN),
        "Inf" => Val::Num(f64::INFINITY),
        "-Inf" => Val::Num(f64::NEG_INFINITY),
        "-0" => Val::Num(-0.0),
        "fn" => Val::Fn,
        "O" => match take(&mut entries, "v") {
            Val::Obj(obj) => Val::Obj(obj),
            _ => Val::Obj(Obj::new()),
        },
        "Map" => Val::Map(take(&mut entries, "v").array_or_empty().iter().map(|pair| (pair.at(0).clone(), pair.at(1).clone())).collect()),
        "Set" => Val::Set(take(&mut entries, "v").array_or_empty().to_vec()),
        "U8" | "U8C" | "I8" | "U16" | "I16" | "U32" | "I32" | "F32" | "F64" => Val::Typed(typed(tag, &mut entries)?),
        other => return Err(format!("unknown tag {other}")),
    })
}

pub fn quote(text: &str, out: &mut String) {
    out.push('"');
    for unit in text.chars() {
        match unit {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            unit if (unit as u32) < 0x20 || unit == '\u{2028}' || unit == '\u{2029}' => out.push_str(&format!("\\u{:04x}", unit as u32)),
            unit => out.push(unit),
        }
    }
    out.push('"');
}

fn number(value: f64, out: &mut String) {
    if value.is_nan() {
        out.push_str("{\"$\":\"NaN\"}");
    } else if value == f64::INFINITY {
        out.push_str("{\"$\":\"Inf\"}");
    } else if value == f64::NEG_INFINITY {
        out.push_str("{\"$\":\"-Inf\"}");
    } else if value == 0.0 && value.is_sign_negative() {
        out.push_str("{\"$\":\"-0\"}");
    } else {
        out.push_str(&js::number_to_string(value));
    }
}

fn entries<'a>(list: impl Iterator<Item = (&'a str, &'a Val)>, out: &mut String) {
    out.push('{');
    let mut first = true;
    for (key, value) in list {
        if !first {
            out.push(',');
        }
        first = false;
        quote(key, out);
        out.push(':');
        write(value, out);
    }
    out.push('}');
}

fn object(obj: &Obj, out: &mut String) {
    if obj.has("$") {
        out.push_str("{\"$\":\"O\",\"v\":");
        entries(obj.entries(), out);
        out.push('}');
    } else {
        entries(obj.entries(), out);
    }
}

fn list<'a>(items: impl Iterator<Item = &'a Val>, out: &mut String) {
    out.push('[');
    let mut first = true;
    for item in items {
        if !first {
            out.push(',');
        }
        first = false;
        write(item, out);
    }
    out.push(']');
}

pub fn write(value: &Val, out: &mut String) {
    match value {
        Val::Undef => out.push_str("{\"$\":\"u\"}"),
        Val::Null => out.push_str("null"),
        Val::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Val::Num(n) => number(*n, out),
        Val::Str(text) => quote(text, out),
        Val::Arr(items) => list(items.iter(), out),
        Val::Obj(obj) => object(obj, out),
        Val::Ref(cell) => object(&cell.borrow(), out),
        Val::Fn => out.push_str("{\"$\":\"fn\"}"),
        Val::Map(pairs) => {
            out.push_str("{\"$\":\"Map\",\"v\":[");
            for (at, (key, item)) in pairs.iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                out.push('[');
                write(key, out);
                out.push(',');
                write(item, out);
                out.push(']');
            }
            out.push_str("]}");
        }
        Val::Set(items) => {
            out.push_str("{\"$\":\"Set\",\"v\":");
            list(items.iter(), out);
            out.push('}');
        }
        Val::Typed(typed) => {
            out.push_str("{\"$\":\"");
            out.push_str(typed.tag());
            out.push_str("\",\"v\":[");
            for (at, item) in typed.values().iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                number(*item, out);
            }
            out.push_str("]}");
        }
    }
}

pub fn text_of(value: &Val) -> String {
    let mut out = String::new();
    write(value, &mut out);
    out
}
