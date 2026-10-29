use std::cmp::Ordering;

#[derive(Clone, Debug, PartialEq)]
pub enum Typed {
    U8(Vec<u8>),
    U8C(Vec<u8>),
    I8(Vec<i8>),
    U16(Vec<u16>),
    I16(Vec<i16>),
    U32(Vec<u32>),
    I32(Vec<i32>),
    F32(Vec<f32>),
    F64(Vec<f64>),
}

impl Typed {
    pub fn len(&self) -> usize {
        match self {
            Typed::U8(v) | Typed::U8C(v) => v.len(),
            Typed::I8(v) => v.len(),
            Typed::U16(v) => v.len(),
            Typed::I16(v) => v.len(),
            Typed::U32(v) => v.len(),
            Typed::I32(v) => v.len(),
            Typed::F32(v) => v.len(),
            Typed::F64(v) => v.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn at(&self, index: usize) -> f64 {
        match self {
            Typed::U8(v) | Typed::U8C(v) => v[index] as f64,
            Typed::I8(v) => v[index] as f64,
            Typed::U16(v) => v[index] as f64,
            Typed::I16(v) => v[index] as f64,
            Typed::U32(v) => v[index] as f64,
            Typed::I32(v) => v[index] as f64,
            Typed::F32(v) => v[index] as f64,
            Typed::F64(v) => v[index],
        }
    }

    pub fn tag(&self) -> &'static str {
        match self {
            Typed::U8(_) => "U8",
            Typed::U8C(_) => "U8C",
            Typed::I8(_) => "I8",
            Typed::U16(_) => "U16",
            Typed::I16(_) => "I16",
            Typed::U32(_) => "U32",
            Typed::I32(_) => "I32",
            Typed::F32(_) => "F32",
            Typed::F64(_) => "F64",
        }
    }

    pub fn values(&self) -> Vec<f64> {
        (0..self.len()).map(|index| self.at(index)).collect()
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Obj(pub Vec<(String, Val)>);

#[derive(Clone, Debug, Default, PartialEq)]
pub enum Val {
    #[default]
    Undef,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Val>),
    Obj(Obj),
    Typed(Typed),
    Map(Vec<(Val, Val)>),
    Set(Vec<Val>),
    Fn,
}

pub fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    match key.parse::<u64>() {
        Ok(value) if value < u32::MAX as u64 => Some(value as u32),
        _ => None,
    }
}

impl Obj {
    pub fn new() -> Self {
        Obj(Vec::new())
    }

    pub fn get(&self, key: &str) -> Option<&Val> {
        self.0.iter().find(|(name, _)| name == key).map(|(_, value)| value)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut Val> {
        self.0.iter_mut().find(|(name, _)| name == key).map(|(_, value)| value)
    }

    pub fn has(&self, key: &str) -> bool {
        self.0.iter().any(|(name, _)| name == key)
    }

    pub fn set(&mut self, key: &str, value: Val) {
        if let Some(slot) = self.get_mut(key) {
            *slot = value;
            return;
        }
        match array_index(key) {
            Some(index) => {
                let at = self.0.iter().position(|(name, _)| match array_index(name) {
                    Some(other) => other > index,
                    None => true,
                });
                match at {
                    Some(at) => self.0.insert(at, (key.to_string(), value)),
                    None => self.0.push((key.to_string(), value)),
                }
            }
            None => self.0.push((key.to_string(), value)),
        }
    }

    pub fn remove(&mut self, key: &str) -> Option<Val> {
        let at = self.0.iter().position(|(name, _)| name == key)?;
        Some(self.0.remove(at).1)
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(name, _)| name.as_str())
    }

    pub fn entries(&self) -> impl Iterator<Item = (&str, &Val)> {
        self.0.iter().map(|(name, value)| (name.as_str(), value))
    }
}

pub static UNDEF: Val = Val::Undef;

impl Val {
    pub fn obj<const N: usize>(entries: [(&str, Val); N]) -> Val {
        let mut out = Obj::new();
        for (key, value) in entries {
            out.set(key, value);
        }
        Val::Obj(out)
    }

    pub fn str(text: &str) -> Val {
        Val::Str(text.to_string())
    }

    pub fn nums(values: &[f64]) -> Val {
        Val::Arr(values.iter().map(|&value| Val::Num(value)).collect())
    }

    pub fn get(&self, key: &str) -> &Val {
        match self {
            Val::Obj(obj) => obj.get(key).unwrap_or(&UNDEF),
            Val::Arr(list) => match array_index(key) {
                Some(index) => list.get(index as usize).unwrap_or(&UNDEF),
                None => &UNDEF,
            },
            _ => &UNDEF,
        }
    }

    pub fn at(&self, index: usize) -> &Val {
        match self {
            Val::Arr(list) => list.get(index).unwrap_or(&UNDEF),
            Val::Obj(obj) => obj.get(&index.to_string()).unwrap_or(&UNDEF),
            _ => &UNDEF,
        }
    }

    pub fn is_nullish(&self) -> bool {
        matches!(self, Val::Undef | Val::Null)
    }

    pub fn is_undef(&self) -> bool {
        matches!(self, Val::Undef)
    }

    pub fn is_object(&self) -> bool {
        matches!(self, Val::Obj(_) | Val::Arr(_) | Val::Typed(_) | Val::Map(_) | Val::Set(_))
    }

    pub fn is_plain_object(&self) -> bool {
        matches!(self, Val::Obj(_) | Val::Typed(_) | Val::Map(_) | Val::Set(_))
    }

    pub fn as_array(&self) -> Option<&Vec<Val>> {
        match self {
            Val::Arr(list) => Some(list),
            _ => None,
        }
    }

    pub fn array_or_empty(&self) -> &[Val] {
        match self {
            Val::Arr(list) => list,
            _ => &[],
        }
    }

    pub fn as_obj(&self) -> Option<&Obj> {
        match self {
            Val::Obj(obj) => Some(obj),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Val::Str(text) => Some(text),
            _ => None,
        }
    }

    pub fn truthy(&self) -> bool {
        match self {
            Val::Undef | Val::Null => false,
            Val::Bool(flag) => *flag,
            Val::Num(value) => !(value.is_nan() || *value == 0.0),
            Val::Str(text) => !text.is_empty(),
            _ => true,
        }
    }

    pub fn is_true(&self) -> bool {
        matches!(self, Val::Bool(true))
    }

    pub fn num(&self) -> f64 {
        to_number(self)
    }

    pub fn string(&self) -> String {
        to_string(self)
    }

    pub fn string_or_empty(&self) -> String {
        if self.is_nullish() {
            String::new()
        } else {
            to_string(self)
        }
    }

    pub fn length(&self) -> Option<usize> {
        match self {
            Val::Arr(list) => Some(list.len()),
            Val::Str(text) => Some(utf16_len(text)),
            Val::Typed(typed) => Some(typed.len()),
            _ => None,
        }
    }

    pub fn typed(&self) -> Option<&Typed> {
        match self {
            Val::Typed(typed) => Some(typed),
            _ => None,
        }
    }

    pub fn element(&self, index: usize) -> Val {
        match self {
            Val::Arr(list) => list.get(index).cloned().unwrap_or(Val::Undef),
            Val::Typed(typed) => {
                if index < typed.len() {
                    Val::Num(typed.at(index))
                } else {
                    Val::Undef
                }
            }
            Val::Str(text) => match text.encode_utf16().nth(index) {
                Some(unit) => Val::Str(String::from_utf16_lossy(&[unit])),
                None => Val::Undef,
            },
            Val::Obj(obj) => obj.get(&index.to_string()).cloned().unwrap_or(Val::Undef),
            _ => Val::Undef,
        }
    }
}

pub fn is_js_whitespace(unit: char) -> bool {
    matches!(unit, '\u{0009}' | '\u{000A}' | '\u{000B}' | '\u{000C}' | '\u{000D}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

pub fn trim(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

pub fn collapse_spaces(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut gap = false;
    for unit in text.chars() {
        if is_js_whitespace(unit) {
            gap = true;
        } else {
            if gap {
                out.push(' ');
                gap = false;
            }
            out.push(unit);
        }
    }
    if gap {
        out.push(' ');
    }
    out
}

pub fn lower(text: &str) -> String {
    text.to_lowercase()
}

pub fn fold(value: &Val) -> String {
    lower(trim(&collapse_spaces(&value.string_or_empty())))
}

pub fn fold_text(text: &str) -> String {
    lower(trim(&collapse_spaces(text)))
}

pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

pub fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

pub fn slice_units(text: &str, start: usize, end: usize) -> String {
    let all = units(text);
    let end = end.min(all.len());
    let start = start.min(end);
    String::from_utf16_lossy(&all[start..end])
}

pub fn compare_units(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

pub fn number_of_text(text: &str) -> f64 {
    let trimmed = trim(text);
    if trimmed.is_empty() {
        return 0.0;
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = trimmed.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|unit| unit.is_digit(radix)) {
                return f64::NAN;
            }
            let mut value = 0.0f64;
            for unit in digits.chars() {
                value = value * radix as f64 + unit.to_digit(radix).unwrap() as f64;
            }
            return value;
        }
    }
    let body = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    let mut seen_digit = false;
    let mut seen_dot = false;
    let mut seen_exp = false;
    let mut exp_digit = true;
    let mut previous = ' ';
    for unit in body.chars() {
        match unit {
            '0'..='9' => {
                if seen_exp {
                    exp_digit = true;
                } else {
                    seen_digit = true;
                }
            }
            '.' if !seen_dot && !seen_exp => seen_dot = true,
            'e' | 'E' if seen_digit && !seen_exp => {
                seen_exp = true;
                exp_digit = false;
            }
            '+' | '-' if matches!(previous, 'e' | 'E') => {}
            _ => return f64::NAN,
        }
        previous = unit;
    }
    if !seen_digit || !exp_digit {
        return f64::NAN;
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

pub fn to_number(value: &Val) -> f64 {
    match value {
        Val::Undef => f64::NAN,
        Val::Null => 0.0,
        Val::Bool(flag) => {
            if *flag {
                1.0
            } else {
                0.0
            }
        }
        Val::Num(number) => *number,
        Val::Str(text) => number_of_text(text),
        Val::Arr(list) => match list.len() {
            0 => 0.0,
            1 => to_number(&Val::Str(to_string(&list[0]))),
            _ => f64::NAN,
        },
        Val::Typed(typed) => match typed.len() {
            0 => 0.0,
            1 => typed.at(0),
            _ => f64::NAN,
        },
        _ => f64::NAN,
    }
}

pub fn number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value == 0.0 {
        return "0".into();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if value < 0.0 {
        return format!("-{}", number_to_string(-value));
    }
    let shown = format!("{:e}", value);
    let (mantissa, exponent) = shown.split_once('e').unwrap();
    let digits: String = mantissa.chars().filter(|unit| *unit != '.').collect();
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().unwrap() + 1;
    if k <= n && n <= 21 {
        let mut out = digits;
        for _ in 0..(n - k) {
            out.push('0');
        }
        out
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), digits)
    } else {
        let e = n - 1;
        let sign = if e < 0 { '-' } else { '+' };
        if k == 1 {
            format!("{}e{}{}", digits, sign, e.abs())
        } else {
            format!("{}.{}e{}{}", &digits[..1], &digits[1..], sign, e.abs())
        }
    }
}

pub fn integer_radix(value: f64, radix: u32) -> String {
    if value == 0.0 {
        return "0".into();
    }
    let negative = value < 0.0;
    let mut rest = value.abs() as u128;
    let mut out = Vec::new();
    while rest > 0 {
        out.push(std::char::from_digit((rest % radix as u128) as u32, radix).unwrap());
        rest /= radix as u128;
    }
    if negative {
        out.push('-');
    }
    out.iter().rev().collect()
}

pub fn to_string(value: &Val) -> String {
    match value {
        Val::Undef => "undefined".into(),
        Val::Null => "null".into(),
        Val::Bool(flag) => if *flag { "true" } else { "false" }.into(),
        Val::Num(number) => number_to_string(*number),
        Val::Str(text) => text.clone(),
        Val::Arr(list) => list.iter().map(|item| if item.is_nullish() { String::new() } else { to_string(item) }).collect::<Vec<_>>().join(","),
        Val::Typed(typed) => typed.values().iter().map(|&item| number_to_string(item)).collect::<Vec<_>>().join(","),
        Val::Fn => "function".into(),
        _ => "[object Object]".into(),
    }
}

pub fn same_value_zero(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Num(x), Val::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        _ => strict_equals(a, b),
    }
}

pub fn strict_equals(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Undef, Val::Undef) | (Val::Null, Val::Null) => true,
        (Val::Bool(x), Val::Bool(y)) => x == y,
        (Val::Num(x), Val::Num(y)) => x == y,
        (Val::Str(x), Val::Str(y)) => x == y,
        _ => false,
    }
}

pub fn is_finite(value: &Val) -> bool {
    matches!(value, Val::Num(number) if number.is_finite())
}

pub fn round(value: f64) -> f64 {
    crate::jsmath::round(value)
}

pub fn to_int32(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    let truncated = value.trunc();
    let modulo = truncated.rem_euclid(4294967296.0);
    modulo as u32 as i32
}

pub fn to_uint32(value: f64) -> u32 {
    to_int32(value) as u32
}

pub fn stable_sort_by<T: Clone, F>(list: &mut [T], mut compare: F)
where
    F: FnMut(&T, &T) -> f64,
{
    let length = list.len();
    if length < 2 {
        return;
    }
    let mut order: Vec<usize> = (0..length).collect();
    let mut spare = order.clone();
    let mut width = 1;
    while width < length {
        let mut start = 0;
        while start < length {
            let middle = (start + width).min(length);
            let end = (start + 2 * width).min(length);
            let (mut left, mut right, mut out) = (start, middle, start);
            while left < middle && right < end {
                if compare(&list[order[right]], &list[order[left]]) < 0.0 {
                    spare[out] = order[right];
                    right += 1;
                } else {
                    spare[out] = order[left];
                    left += 1;
                }
                out += 1;
            }
            while left < middle {
                spare[out] = order[left];
                left += 1;
                out += 1;
            }
            while right < end {
                spare[out] = order[right];
                right += 1;
                out += 1;
            }
            start = end;
        }
        std::mem::swap(&mut order, &mut spare);
        width *= 2;
    }
    let sorted: Vec<T> = order.iter().map(|&index| list[index].clone()).collect();
    list.clone_from_slice(&sorted);
}

pub fn sort_numbers(list: &mut [f64]) {
    stable_sort_by(list, |a, b| a - b);
}

pub fn default_sort(list: &mut [Val]) {
    let mut defined: Vec<Val> = list.iter().filter(|item| !item.is_undef()).cloned().collect();
    let undefined = list.len() - defined.len();
    defined.sort_by(|a, b| compare_units(&to_string(a), &to_string(b)));
    for _ in 0..undefined {
        defined.push(Val::Undef);
    }
    list.clone_from_slice(&defined);
}

pub fn or_zero(value: f64) -> f64 {
    if value.is_nan() || value == 0.0 {
        0.0
    } else {
        value
    }
}

pub fn entries(value: &Val) -> Vec<(String, Val)> {
    match value {
        Val::Obj(obj) => obj.entries().map(|(key, item)| (key.to_string(), item.clone())).collect(),
        Val::Arr(list) => list.iter().enumerate().map(|(at, item)| (at.to_string(), item.clone())).collect(),
        Val::Typed(typed) => (0..typed.len()).map(|at| (at.to_string(), Val::Num(typed.at(at)))).collect(),
        Val::Str(text) => text.encode_utf16().enumerate().map(|(at, unit)| (at.to_string(), Val::Str(String::from_utf16_lossy(&[unit])))).collect(),
        _ => Vec::new(),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OrdMap<K: Clone + PartialEq, V: Clone> {
    pub entries: Vec<(K, V)>,
}

impl<K: Clone + PartialEq, V: Clone> Default for OrdMap<K, V> {
    fn default() -> Self {
        OrdMap { entries: Vec::new() }
    }
}

impl<K: Clone + PartialEq, V: Clone> OrdMap<K, V> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.entries.iter().find(|(name, _)| name == key).map(|(_, value)| value)
    }

    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        self.entries.iter_mut().find(|(name, _)| name == key).map(|(_, value)| value)
    }

    pub fn has(&self, key: &K) -> bool {
        self.entries.iter().any(|(name, _)| name == key)
    }

    pub fn set(&mut self, key: K, value: V) {
        match self.get_mut(&key) {
            Some(slot) => *slot = value,
            None => self.entries.push((key, value)),
        }
    }

    pub fn remove(&mut self, key: &K) -> Option<V> {
        let at = self.entries.iter().position(|(name, _)| name == key)?;
        Some(self.entries.remove(at).1)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.entries.iter().map(|(_, value)| value)
    }

    pub fn keys(&self) -> impl Iterator<Item = &K> {
        self.entries.iter().map(|(key, _)| key)
    }
}

pub fn spread(value: &Val) -> Obj {
    let mut out = Obj::new();
    for (key, item) in entries(value) {
        out.set(&key, item);
    }
    out
}

pub fn is_integer(value: &Val) -> bool {
    matches!(value, Val::Num(n) if n.is_finite() && n.trunc() == *n)
}

pub fn side_index(value: &Val) -> Option<usize> {
    match value {
        Val::Num(n) if *n == 0.0 => Some(0),
        Val::Num(n) if *n == 1.0 => Some(1),
        _ => None,
    }
}
