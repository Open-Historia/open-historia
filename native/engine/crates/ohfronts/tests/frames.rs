use ohfronts::{Arrow, FrontFrames};
use serde_json::Value;

fn number(value: &Value) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::Null => 0.0,
        Value::String(text) => ohfronts::frames::js_number_of_text(text),
        _ => f64::NAN,
    }
}

#[test]
fn frames_match_the_sidecar_digests() {
    let fixture: Value = serde_json::from_str(include_str!("frames.json")).unwrap();
    let mut frames = FrontFrames::new();
    frames.load_json(fixture["frames"].as_str().unwrap()).unwrap();
    let requests = fixture["requests"].as_array().unwrap();
    let digests = fixture["digests"].as_array().unwrap();
    assert_eq!(requests.len(), digests.len());
    for (at, (request, want)) in requests.iter().zip(digests).enumerate() {
        let days: Vec<(String, f64)> = request["days"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| (ohfronts::frames::js_trim(entry[0].as_str().unwrap_or("")).to_string(), entry.get(1).map(number).unwrap_or(f64::NAN)))
            .collect();
        let out = frames.frame(&days, number(&request["zoom"]));
        let (mut arrows, mut past, mut geometry, mut indices, mut palette, mut alpha) = (0.0, 0.0, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for arrow in &out.arrows {
            arrows += 1.0;
            match arrow {
                Arrow::Past { f, rgb, alpha: shown, line } => {
                    past += 1.0;
                    for value in line {
                        geometry += value;
                    }
                    palette += f + *rgb as f64 + 0.0;
                    alpha += shown;
                }
                Arrow::Shape { f, rgb, dark, alpha: shown, points, indices: list } => {
                    for value in points {
                        geometry += value;
                    }
                    for value in list {
                        indices += *value as f64;
                    }
                    palette += f + *rgb as f64 + *dark as f64;
                    alpha += shown;
                }
            }
        }
        let mut counters = 0.0f64;
        let mut words = String::new();
        for row in &out.troops {
            for value in [row.x, row.y, row.side as f64, row.index as f64, row.command, row.rgb as f64] {
                counters += value;
            }
            words.push_str(row.glyph);
            words.push('|');
            counters += row.strength;
            words.push_str(row.state);
            words.push('|');
            for value in [f64::from(u8::from(row.named)), f64::from(u8::from(row.moving))] {
                counters += value;
            }
            words.push_str(&row.label);
            words.push('|');
            counters += row.f;
        }
        for row in &out.sides {
            for value in [row.x, row.y, row.side as f64, row.command, row.rgb as f64, row.count as f64, row.strength, row.f] {
                counters += value;
            }
        }
        let colours: Vec<Vec<f64>> = out.colours.iter().map(|rgb| rgb.to_vec()).collect();
        let want_colours: Vec<Vec<f64>> = want["colours"].as_array().unwrap().iter().map(|rgb| rgb.as_array().unwrap().iter().map(number).collect()).collect();
        assert_eq!(arrows, number(&want["arrows"]), "frame {at}: arrows");
        assert_eq!(past, number(&want["past"]), "frame {at}: past lines");
        assert_eq!(geometry.to_bits(), number(&want["geometry"]).to_bits(), "frame {at}: geometry {geometry} vs {}", want["geometry"]);
        assert_eq!(indices, number(&want["indices"]), "frame {at}: indices");
        assert_eq!(palette, number(&want["palette"]), "frame {at}: palette");
        assert_eq!(alpha.to_bits(), number(&want["alpha"]).to_bits(), "frame {at}: alpha");
        assert_eq!(out.troops.len() as f64, number(&want["troops"]), "frame {at}: troops");
        assert_eq!(out.sides.len() as f64, number(&want["sides"]), "frame {at}: sides");
        assert_eq!(counters.to_bits(), number(&want["counters"]).to_bits(), "frame {at}: counters {counters} vs {}", want["counters"]);
        assert_eq!(words, want["words"].as_str().unwrap(), "frame {at}: words");
        assert_eq!(colours, want_colours, "frame {at}: colours");
    }
}
