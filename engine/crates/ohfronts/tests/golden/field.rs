use crate::arena::arena_of;
use crate::support::*;
use ohfronts::sim::codec::Strand;
use ohfronts::sim::field::*;
use ohfronts::sim::js::{Typed, Val};
use ohfronts::sim::line::{draw_line, measure, Measured};
use ohfronts::sim::sectors::*;
use std::cell::OnceCell;
use std::rc::Rc;

const CONTOUR_KEYS: [&str; 9] = ["strands", "x", "y", "cellA", "cellB", "segments", "from", "to", "square"];

fn ints(value: &Val) -> Vec<i32> {
    arg_numbers(value).iter().map(|&n| n as i32).collect()
}

fn bytes(value: &Val) -> Vec<u8> {
    arg_numbers(value).iter().map(|&n| n as u8).collect()
}

pub fn sides_of(value: &Val) -> Vec<i32> {
    let length = value.length().unwrap_or(0);
    (0..length)
        .map(|at| match value.element(at) {
            Val::Num(n) if n.is_finite() && n.trunc() == n => n as i32,
            _ => -1,
        })
        .collect()
}

pub fn measured_of(value: &Val) -> Measured {
    Measured {
        count: value.get("count").num() as usize,
        km: arg_numbers(value.get("km")),
        nx: arg_numbers(value.get("nx")),
        ny: arg_numbers(value.get("ny")),
        strand: ints(value.get("strand")),
        total: value.get("total").num(),
    }
}

pub fn contour_of(value: &Val) -> Contour {
    let contour = Contour {
        strands: value
            .get("strands")
            .array_or_empty()
            .iter()
            .map(|s| StrandSpan { closed: s.get("closed").truthy(), first: s.get("first").num() as usize, count: s.get("count").num() as usize })
            .collect(),
        x: arg_numbers(value.get("x")),
        y: arg_numbers(value.get("y")),
        cell_a: ints(value.get("cellA")),
        cell_b: ints(value.get("cellB")),
        segments: value.get("segments").num() as usize,
        from: ints(value.get("from")),
        to: ints(value.get("to")),
        square: ints(value.get("square")),
        buckets: OnceCell::new(),
        measured: OnceCell::new(),
    };
    if value.get("heads").is_object() {
        let _ = contour.buckets.set((ints(value.get("heads")), ints(value.get("nexts"))));
    }
    if value.get("measured").is_object() {
        let _ = contour.measured.set(Rc::new(measured_of(value.get("measured"))));
    }
    contour
}

pub fn contour_val(contour: &Contour) -> Val {
    Val::obj([
        ("strands", list(contour.strands.iter().map(|s| Val::obj([("closed", Val::Bool(s.closed)), ("first", num(s.first as f64)), ("count", num(s.count as f64))])).collect())),
        ("x", f64s(contour.x.clone())),
        ("y", f64s(contour.y.clone())),
        ("cellA", i32s(contour.cell_a.clone())),
        ("cellB", i32s(contour.cell_b.clone())),
        ("segments", num(contour.segments as f64)),
        ("from", i32s(contour.from.clone())),
        ("to", i32s(contour.to.clone())),
        ("square", i32s(contour.square.clone())),
    ])
}

fn bodies_val(bodies: &Bodies) -> Val {
    Val::obj([
        ("turns", num(bodies.turns as f64)),
        ("label", i32s(bodies.label.clone())),
        ("sizes", list(bodies.sizes.iter().map(|&n| num(n as f64)).collect())),
        ("count", num(bodies.count as f64)),
    ])
}

pub fn field_of(value: &Val) -> Field {
    let arena = Rc::new(arena_of(value.get("arena")));
    let size = value.get("size").num() as usize;
    let bodies_at = |at: usize| -> Option<Rc<Bodies>> {
        let b = value.get("bodies").at(at);
        if !b.is_object() {
            return None;
        }
        Some(Rc::new(Bodies { turns: b.get("turns").num() as i64, label: ints(b.get("label")), sizes: arg_numbers(b.get("sizes")).iter().map(|&n| n as usize).collect(), count: b.get("count").num() as usize }))
    };
    Field {
        arena,
        cols: value.get("cols").num() as usize,
        rows: value.get("rows").num() as usize,
        size,
        play: bytes(value.get("play")),
        holders: bytes(value.get("holders")),
        phi: arg_numbers(value.get("phi")),
        ghost: ints(value.get("ghost")),
        changed: arg_numbers(value.get("changed")).iter().map(|&n| n as usize).collect(),
        marked: bytes(value.get("marked")),
        painter: bytes(value.get("painter")),
        when: arg_numbers(value.get("when")).iter().map(|&n| n as f32).collect(),
        edits: value.get("edits").num() as i64,
        turns: value.get("turns").num() as i64,
        contour: if value.get("contour").is_object() { Some(Rc::new(contour_of(value.get("contour")))) } else { None },
        contour_edits: value.get("contourEdits").num() as i64,
        piece_from: vec![-1; size * 2],
        piece_to: vec![-1; size * 2],
        seen: if value.get("seen").is_object() { Some(bytes(value.get("seen"))) } else { None },
        bodies: [bodies_at(0), bodies_at(1)],
    }
}

pub fn field_val(field: &Field) -> Val {
    Val::obj([
        ("cols", num(field.cols as f64)),
        ("rows", num(field.rows as f64)),
        ("size", num(field.size as f64)),
        ("play", u8s(field.play.clone())),
        ("holders", u8s(field.holders.clone())),
        ("phi", f64s(field.phi.clone())),
        ("ghost", i32s(field.ghost.clone())),
        ("changed", list(field.changed.iter().map(|&n| num(n as f64)).collect())),
        ("marked", u8s(field.marked.clone())),
        ("painter", u8s(field.painter.clone())),
        ("when", Val::Typed(Typed::F32(field.when.clone()))),
        ("edits", num(field.edits as f64)),
        ("turns", num(field.turns as f64)),
        ("contourEdits", num(field.contour_edits as f64)),
    ])
}

fn same_field(field: &Field, want: &Val) -> Result<(), String> {
    let got = field_val(field);
    for key in ["cols", "rows", "size", "play", "holders", "phi", "ghost", "changed", "marked", "painter", "when", "edits", "turns", "contourEdits"] {
        same(got.get(key), want.get(key)).map_err(|error| format!("field.{key}: {error}"))?;
    }
    Ok(())
}

fn field_after(case: &Case, field: &Field) -> Result<(), String> {
    let want = case.after.as_ref().map(|after| &after[0]).unwrap_or(&case.args[0]);
    same_field(field, want)
}

fn ice_of(value: &Val) -> Option<Vec<i32>> {
    if value.is_nullish() {
        None
    } else {
        Some(sides_of(value))
    }
}

fn cells_of(value: &Val) -> Vec<usize> {
    arg_numbers(value).iter().map(|&n| n as usize).collect()
}

fn strand_val(strand: &Strand) -> Val {
    Val::obj([("closed", Val::Bool(strand.closed)), ("points", list(strand.points.iter().map(|p| nums(p)).collect())), ("flags", nums(&strand.flags))])
}

fn measured_val(measured: &Measured) -> Val {
    Val::obj([
        ("count", num(measured.count as f64)),
        ("km", f64s(measured.km.clone())),
        ("nx", f64s(measured.nx.clone())),
        ("ny", f64s(measured.ny.clone())),
        ("strand", i32s(measured.strand.clone())),
        ("total", num(measured.total)),
    ])
}

#[test]
fn field_matches_js() {
    run(
        "field",
        &[
            ("setGround", &|case| {
                let mut field = field_of(case.arg(0));
                let ice = ice_of(case.arg(2));
                let changed = set_ground(&mut field, &sides_of(case.arg(1)), ice.as_deref());
                Some(expect(case, Val::Bool(changed))?.and_then(|_| field_after(case, &field)))
            }),
            ("traceContour", &|case| {
                let mut field = field_of(case.arg(0));
                let contour = trace_contour(&mut field);
                Some(expect_keys(case, contour_val(&contour), &CONTOUR_KEYS)?.and_then(|_| field_after(case, &field)))
            }),
            ("nearestOnContour", &|case| {
                let field = field_of(case.arg(0));
                let contour = contour_of(case.arg(1));
                let found = nearest_on_contour(&field, &contour, case.arg(2).num(), case.arg(3).num(), case.arg(4).num());
                expect(case, num(found.distance))
            }),
            ("takeCapsule", &|case| {
                let mut field = field_of(case.arg(0));
                let how = case.arg(8);
                let mut claims = if how.get("claims").is_object() {
                    let c = how.get("claims");
                    Some(Claims { stamp: ints(c.get("stamp")), power: arg_numbers(c.get("power")).iter().map(|&n| n as f32).collect(), moment: c.get("moment").num() })
                } else {
                    None
                };
                let spare = if how.get("spare").is_nullish() { None } else { Some(arg_numbers(how.get("spare"))) };
                let keep = if how.get("keep").is_nullish() { None } else { Some(bytes(how.get("keep"))) };
                let or = |key: &str, fallback: f64| if how.get(key).is_nullish() { fallback } else { how.get(key).num() };
                let a = |at: usize| case.arg(at).num();
                take_capsule(
                    &mut field,
                    a(1) as u8,
                    a(2),
                    a(3),
                    a(4),
                    a(5),
                    a(6),
                    a(7),
                    How {
                        claims: claims.as_mut(),
                        strength: or("strength", 0.0),
                        painter: or("painter", 0.0),
                        painter_q: if how.get("painterQ").is_nullish() { None } else { Some(how.get("painterQ").num()) },
                        from: if how.get("from").is_nullish() { None } else { Some(how.get("from").num()) },
                        span: or("span", 0.0),
                        spare: spare.as_deref(),
                        keep: keep.as_deref(),
                    },
                );
                let after = case.after.as_ref().and_then(|after| after.get(8).cloned()).unwrap_or_else(|| case.arg(8).clone());
                Some(field_after(case, &field).and_then(|_| match &claims {
                    Some(claims) => {
                        same(&i32s(claims.stamp.clone()), after.get("claims").get("stamp"))?;
                        same(&Val::Typed(Typed::F32(claims.power.clone())), after.get("claims").get("power"))
                    }
                    None => Ok(()),
                }))
            }),
            ("takeCells", &|case| {
                let mut field = field_of(case.arg(0));
                let script = Script::new(case, "3");
                let mut by = |index: usize| script.call(&[num(index as f64)]).num();
                let painter = match case.arg(3) {
                    Val::Fn => Painter::By(&mut by),
                    Val::Undef => Painter::Value(0.0),
                    other => Painter::Value(other.num()),
                };
                take_cells(&mut field, case.arg(1).num() as u8, &cells_of(case.arg(2)), painter);
                Some(field_after(case, &field).and_then(|_| script.done()))
            }),
            ("restoreCells", &|case| {
                let mut field = field_of(case.arg(0));
                let script = Script::new(case, "3");
                let scripted = matches!(case.arg(3), Val::Fn);
                restore_cells(&mut field, &cells_of(case.arg(1)), &arg_numbers(case.arg(2)), |index| if scripted { script.call(&[num(index as f64)]).num() } else { 0.0 });
                Some(field_after(case, &field).and_then(|_| script.done()))
            }),
            ("redistance", &|case| {
                let mut field = field_of(case.arg(0));
                redistance(&mut field);
                Some(field_after(case, &field))
            }),
            ("rebuildDistances", &|case| {
                let mut field = field_of(case.arg(0));
                rebuild_distances(&mut field, case.arg(1).truthy());
                Some(field_after(case, &field))
            }),
            ("rebuildFromHolders", &|case| {
                let mut field = field_of(case.arg(0));
                rebuild_from_holders(&mut field);
                Some(field_after(case, &field))
            }),
            ("openField", &|case| {
                let ice = ice_of(case.arg(3));
                let field = open_field(Rc::new(arena_of(case.arg(0))), case.arg(1).array_or_empty(), &sides_of(case.arg(2)), ice.as_deref());
                match (&field, &case.result) {
                    (None, Some(want)) => Some(same(&Val::Null, want)),
                    (Some(field), Some(want)) => Some(same_field(field, want)),
                    _ => None,
                }
            }),
            ("packField", &|case| {
                let packed = pack_field(&field_of(case.arg(0)));
                expect(case, Val::obj([("mask", text(&packed.mask)), ("band", text(&packed.band)), ("key", text(&packed.key))]))
            }),
            ("unpackField", &|case| {
                let saved = case.arg(1);
                let ice = ice_of(case.arg(3));
                let field = unpack_field(Rc::new(arena_of(case.arg(0))), &arg_text(saved.get("mask")), &arg_text(saved.get("band")), saved.get("key").as_str(), &sides_of(case.arg(2)), ice.as_deref());
                case.result.as_ref().map(|want| same_field(&field, want))
            }),
            ("resampleField", &|case| {
                let ice = ice_of(case.arg(3));
                let field = resample_field(&field_of(case.arg(0)), Rc::new(arena_of(case.arg(1))), &sides_of(case.arg(2)), ice.as_deref());
                case.result.as_ref().map(|want| same_field(&field, want))
            }),
            ("readField", &|case| expect(case, num(read_field(&field_of(case.arg(0)), case.arg(1).num(), case.arg(2).num())))),
            ("holderAtPoint", &|case| expect(case, num(holder_at_point(&field_of(case.arg(0)), case.arg(1).num(), case.arg(2).num()) as f64))),
            ("nearestHeld", &|case| expect(case, num(nearest_held(&field_of(case.arg(0)), case.arg(1).num() as u8, case.arg(2).num(), case.arg(3).num(), case.arg(4).num()) as f64))),
            ("ownCell", &|case| expect(case, num(own_cell(&field_of(case.arg(0)), case.arg(1).num() as u8, case.arg(2).num(), case.arg(3).num()) as f64))),
            ("bodiesOf", &|case| {
                let mut field = field_of(case.arg(0));
                let bodies = bodies_of(&mut field, case.arg(1).num() as usize);
                expect(case, bodies_val(&bodies))
            }),
            ("countHolders", &|case| expect(case, nums(&count_holders(&field_of(case.arg(0)))))),
        ],
    );
}

fn line_parts(value: &Val) -> (Contour, usize) {
    (contour_of(value.get("contour")), value.get("count").num() as usize)
}

fn cut_val(cut: &Cut) -> Val {
    Val::obj([("x", num(cut.x)), ("y", num(cut.y)), ("from", num(cut.from)), ("to", num(cut.to))])
}

fn sector_val(sector: &Sector) -> Val {
    match sector {
        Sector::All => Val::obj([("kind", text("all"))]),
        Sector::Cut { word, cut } => Val::obj([("kind", text("cut")), ("word", text(word)), ("x", num(cut.x)), ("y", num(cut.y)), ("from", num(cut.from)), ("to", num(cut.to))]),
        Sector::Place { word, px, py } => Val::obj([("kind", text("place")), ("word", text(word)), ("px", num(*px)), ("py", num(*py))]),
    }
}

fn sector_of(value: &Val) -> Sector {
    match value.get("kind").as_str() {
        Some("all") => Sector::All,
        Some("cut") => Sector::Cut { word: value.get("word").string_or_empty(), cut: Cut { x: value.get("x").num(), y: value.get("y").num(), from: value.get("from").num(), to: value.get("to").num() } },
        _ => Sector::Place { word: value.get("word").string_or_empty(), px: value.get("px").num(), py: value.get("py").num() },
    }
}

fn sectors_of(value: &Val) -> Sectors {
    let cuts = match value.get("cuts") {
        Val::Map(entries) => entries.iter().map(|(key, cut)| (key.string(), Cut { x: cut.get("x").num(), y: cut.get("y").num(), from: cut.get("from").num(), to: cut.get("to").num() })).collect(),
        _ => Vec::new(),
    };
    Sectors { axis: value.get("axis").string_or_empty(), names: value.get("names").array_or_empty().iter().map(|n| n.string()).collect(), cuts }
}

fn place_val(place: &Place) -> Val {
    let mut out = Val::obj([("kind", text(place.kind)), ("name", text(&place.name)), ("x", num(place.x)), ("y", num(place.y))]);
    if let Val::Obj(obj) = &mut out {
        if let Some(cell) = place.cell {
            obj.set("cell", num(cell));
        }
        if let Some(region) = place.region {
            obj.set("region", num(region as f64));
        }
    }
    out
}

#[test]
fn line_matches_js() {
    run(
        "line",
        &[
            ("measureLine", &|case| {
                let field = field_of(case.arg(0));
                let contour = contour_of(case.arg(1));
                expect_keys(case, measured_val(&measure(&field, &contour)), &["count", "km", "nx", "ny", "strand", "total"])
            }),
            ("drawLine", &|case| {
                let contour = contour_of(case.arg(0));
                let flags = arg_numbers(case.arg(1));
                expect(case, list(draw_line(&contour, &flags).iter().map(strand_val).collect()))
            }),
        ],
    );
}

#[test]
fn sectors_match_js() {
    run(
        "sectors",
        &[
            ("readSectors", &|case| {
                let (contour, count) = line_parts(case.arg(0));
                let sectors = read_sectors(&contour, count);
                expect(
                    case,
                    Val::obj([
                        ("axis", text(&sectors.axis)),
                        ("names", list(sectors.names.iter().map(|n| text(n)).collect())),
                        ("cuts", Val::Map(sectors.cuts.iter().map(|(key, cut)| (text(key), cut_val(cut))).collect())),
                    ]),
                )
            }),
            ("findPlace", &|case| expect(case, find_place(&crate::arena::arena_of(case.arg(0)), case.arg(1)).as_ref().map(place_val).unwrap_or(Val::Null))),
            ("placeText", &|case| expect(case, text(&place_text(&case.arg(0).get("kind").string(), &case.arg(0).get("name").string())))),
            ("describePoint", &|case| expect(case, text(&describe_point(&crate::arena::arena_of(case.arg(0)), case.arg(1).num(), case.arg(2).num())))),
            ("nearestVertex", &|case| {
                let (contour, count) = line_parts(case.arg(0));
                expect(case, num(nearest_vertex(&contour, count, case.arg(1).num(), case.arg(2).num()) as f64))
            }),
            ("resolveSector", &|case| {
                let (contour, count) = line_parts(case.arg(1));
                let found = resolve_sector(&crate::arena::arena_of(case.arg(0)), &contour, count, &sectors_of(case.arg(2)), case.arg(3));
                expect(case, found.as_ref().map(sector_val).unwrap_or(Val::Null))
            }),
            ("inSector", &|case| {
                let script = Script::new(case, "3");
                let got = in_sector(&sector_of(case.arg(0)), case.arg(1).num(), case.arg(2).num(), |y| script.call(&[num(y)]).num());
                Some(expect(case, Val::Bool(got))?.and_then(|_| script.done()))
            }),
            ("sectorMiddle", &|case| {
                let (contour, count) = line_parts(case.arg(0));
                let script = Script::new(case, "2");
                let got = sector_middle(&contour, count, &sector_of(case.arg(1)), |y| script.call(&[num(y)]).num());
                Some(expect(case, nums(&got))?.and_then(|_| script.done()))
            }),
        ],
    );
}
