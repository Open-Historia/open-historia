use crate::support::*;
use ohfronts::sim::codec::*;
use ohfronts::sim::constants::{BAND_CELLS, TROOP_KINDS, TROOP_STATES};
use ohfronts::sim::js::{self, Typed, Val};

fn list_of(value: &Val) -> &[Val] {
    value.array_or_empty()
}

fn troop_code(troop: &Val) -> TroopCode {
    TroopCode {
        x: troop.get("x").num(),
        y: troop.get("y").num(),
        strength: troop.get("strength").num(),
        kind: index_in(&TROOP_KINDS, troop.get("kind")),
        owner: troop.get("owner").num(),
        named: troop.get("named").truthy(),
        dig: troop.get("dig").num(),
        state: index_in(&TROOP_STATES, troop.get("state")),
    }
}

fn strand_of(strand: &Val) -> Strand {
    let points = match strand.get("points") {
        Val::Arr(points) => points.iter().map(|point| [point.element(0).num(), point.element(1).num()]).collect(),
        _ => Vec::new(),
    };
    let flags_val = strand.get("flags");
    let points: Vec<[f64; 2]> = points;
    let flags = (0..points.len())
        .map(|index| {
            let flag = if flags_val.is_nullish() { Val::Undef } else { flags_val.element(index) };
            if flag.is_nullish() {
                0.0
            } else {
                flag.num()
            }
        })
        .collect();
    Strand { closed: strand.get("closed").truthy(), points, flags }
}

fn strand_val(strand: &Strand) -> Val {
    Val::obj([
        ("closed", Val::Bool(strand.closed)),
        ("points", list(strand.points.iter().map(|p| nums(p)).collect())),
        ("flags", nums(&strand.flags)),
    ])
}

fn sample_code(sample: &Val) -> SampleCode {
    SampleCode {
        day: sample.get("day").num(),
        x: sample.get("x").num(),
        y: sample.get("y").num(),
        strength: sample.get("strength").num(),
        state: index_in(&TROOP_STATES, sample.get("state")),
    }
}

fn length_arg(value: &Val) -> f64 {
    value.num()
}

#[test]
fn codec_matches_js() {
    run(
        "codec",
        &[
            ("encodeMask", &|case| expect(case, text(&encode_mask(&arg_bytes(case.arg(0)))))),
            ("decodeMask", &|case| expect(case, u8s(decode_mask(&arg_text(case.arg(0)), length_arg(case.arg(1)))))),
            ("decodeFourMask", &|case| expect(case, u8s(decode_four_mask(&arg_text(case.arg(0)), length_arg(case.arg(1)))))),
            ("bandIndices", &|case| {
                let reach = if case.arg(3).is_undef() { BAND_CELLS } else { case.arg(3).num() };
                let cols = case.arg(1).num() as usize;
                let rows = case.arg(2).num() as usize;
                expect(case, i32s(band_indices(&arg_bytes(case.arg(0)), cols, rows, reach)))
            }),
            ("encodeBand", &|case| expect(case, text(&encode_band(&arg_numbers(case.arg(0)))))),
            ("decodeBand", &|case| expect(case, i8s(decode_band(&arg_text(case.arg(0)), length_arg(case.arg(1)))))),
            ("encodeTroops", &|case| {
                let troops: Vec<TroopCode> = list_of(case.arg(0)).iter().map(troop_code).collect();
                expect(case, text(&encode_troops(&troops)))
            }),
            ("decodeTroops", &|case| {
                let troops = decode_troops(&arg_text(case.arg(0)));
                expect(
                    case,
                    list(
                        troops
                            .iter()
                            .map(|t| {
                                Val::obj([
                                    ("x", num(t.x)),
                                    ("y", num(t.y)),
                                    ("strength", num(t.strength)),
                                    ("kind", num(t.kind as f64)),
                                    ("owner", num(t.owner as f64)),
                                    ("named", Val::Bool(t.named)),
                                    ("dig", num(t.dig)),
                                    ("state", num(t.state as f64)),
                                ])
                            })
                            .collect(),
                    ),
                )
            }),
            ("encodeLevels", &|case| {
                let values: Vec<f64> = list_of(case.arg(0)).iter().map(|v| v.num()).collect();
                expect(case, text(&encode_levels(&values)))
            }),
            ("decodeLevels", &|case| expect(case, nums(&decode_levels(&arg_text(case.arg(0)))))),
            ("encodeLines", &|case| {
                let strands: Vec<Strand> = list_of(case.arg(0)).iter().map(strand_of).collect();
                expect(case, text(&encode_lines(&strands)))
            }),
            ("decodeLines", &|case| expect(case, list(decode_lines(&arg_text(case.arg(0))).iter().map(strand_val).collect()))),
            ("encodeTracks", &|case| {
                let tracks: Vec<Vec<SampleCode>> = list_of(case.arg(0)).iter().map(|track| list_of(track).iter().map(sample_code).collect()).collect();
                expect(case, text(&encode_tracks(&tracks)))
            }),
            ("decodeTracks", &|case| {
                let tracks = decode_tracks(&arg_text(case.arg(0)));
                expect(
                    case,
                    list(
                        tracks
                            .iter()
                            .map(|track| {
                                list(
                                    track
                                        .iter()
                                        .map(|s| Val::obj([("day", num(s.day)), ("x", num(s.x)), ("y", num(s.y)), ("strength", num(s.strength)), ("state", num(s.state as f64))]))
                                        .collect(),
                                )
                            })
                            .collect(),
                    ),
                )
            }),
            ("encodeStates", &|case| expect(case, text(&encode_states(&arg_bytes(case.arg(0)))))),
            ("decodeStates", &|case| expect(case, u8s(decode_states(&arg_text(case.arg(0)), length_arg(case.arg(1)))))),
            ("encodePaint", &|case| {
                let changes: Vec<PaintChange> = list_of(case.arg(0))
                    .iter()
                    .map(|c| PaintChange { tick: c.get("tick").num(), cell: c.get("cell").num(), state: c.get("state").num() })
                    .collect();
                expect(case, text(&encode_paint(&changes)))
            }),
            ("decodePaint", &|case| {
                let paint = decode_paint(&arg_text(case.arg(0)));
                expect(
                    case,
                    Val::obj([
                        ("ticks", Val::Typed(Typed::U32(paint.ticks))),
                        ("cells", Val::Typed(Typed::U16(paint.cells))),
                        ("states", Val::Typed(Typed::U8(paint.states))),
                    ]),
                )
            }),
            ("hashKey", &|case| {
                let parts: Vec<String> = match case.arg(0) {
                    Val::Arr(items) => items.iter().map(|item| if item.is_nullish() { String::new() } else { js::to_string(item) }).collect(),
                    other => vec![if other.is_nullish() { String::new() } else { js::to_string(other) }],
                };
                let refs: Vec<&str> = parts.iter().map(|s| s.as_str()).collect();
                expect(case, text(&hash_key(&refs)))
            }),
        ],
    );
}
