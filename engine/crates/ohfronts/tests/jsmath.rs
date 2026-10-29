use ohfronts::jsmath;

fn check(text: &str) -> (usize, Vec<String>) {
    let mut count = 0;
    let mut wrong = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() != 3 {
            continue;
        }
        let x = f64::from_bits(u64::from_str_radix(parts[1], 16).unwrap());
        let want = u64::from_str_radix(parts[2], 16).unwrap();
        let got = match parts[0] {
            "log" => jsmath::log(x),
            "log2" => jsmath::log2(x),
            "exp" => jsmath::exp(x),
            "atan" => jsmath::atan(x),
            "tan" => jsmath::tan(x),
            "pow2" => jsmath::pow2(x),
            "hypot" => jsmath::hypot(x, f64::from_bits(want)),
            _ => continue,
        };
        count += 1;
        if got.to_bits() != want && !(got.is_nan() && f64::from_bits(want).is_nan()) {
            if wrong.len() < 20 {
                wrong.push(format!("{} {:e} -> {:e} wanted {:e}", parts[0], x, got, f64::from_bits(want)));
            } else {
                wrong.push(String::new());
            }
        }
    }
    (count, wrong)
}

#[test]
fn math_matches_v8() {
    let text = include_str!("jsmath.txt");
    let (count, wrong) = check(text);
    assert!(count > 0);
    assert!(wrong.is_empty(), "{} of {} differ: {:?}", wrong.len(), count, &wrong[..wrong.len().min(20)]);
    if let Ok(path) = std::env::var("OHFRONTS_MATH_VECTORS") {
        let text = std::fs::read_to_string(path).unwrap();
        let (count, wrong) = check(&text);
        assert!(wrong.is_empty(), "{} of {} differ: {:?}", wrong.len(), count, &wrong[..wrong.len().min(20)]);
        println!("{count} vectors match");
    }
}
