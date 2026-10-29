use crate::support::*;
use ohfronts::sim::frame::KM_PER_DEGREE;
use ohfronts::sim::js::{Typed, Val};
use ohfronts::sim::world_grid::*;

pub fn surface_of(options: &Val) -> Surface {
    Surface { flat: options.get("flat").truthy(), scale: if options.get("scale").is_undef() { KM_PER_DEGREE } else { options.get("scale").num() } }
}

fn typed_u8(value: &Val) -> Vec<u8> {
    arg_numbers(value).iter().map(|&n| n as u8).collect()
}

fn typed_i32(value: &Val) -> Vec<i32> {
    arg_numbers(value).iter().map(|&n| n as i32).collect()
}

pub fn grid_of(value: &Val) -> WorldGrid {
    let step_km = value.get("stepKm");
    WorldGrid {
        cols: value.get("cols").num() as usize,
        rows: value.get("rows").num() as usize,
        west: value.get("west").num(),
        north: value.get("north").num(),
        step: value.get("step").num(),
        wrap: value.get("wrap").truthy(),
        flat: value.get("flat").truthy(),
        scale: value.get("scale").num(),
        land: typed_u8(value.get("land")),
        region: typed_i32(value.get("region")),
        ids: value.get("ids").array_or_empty().iter().map(|id| id.string()).collect(),
        full: value.get("full").num() as u8,
        step_km: StepKm { along: arg_numbers(step_km.get("along")), aslant: arg_numbers(step_km.get("aslant")), down: step_km.get("down").num() },
        row_cosine: arg_numbers(value.get("rowCosine")),
        seas: if value.get("seas").is_undef() { None } else { Some(typed_i32(value.get("seas"))) },
        sea_count: value.get("seaCount").num() as usize,
    }
}

pub fn grid_val(grid: &WorldGrid) -> Val {
    let mut out = Val::obj([
        ("cols", num(grid.cols as f64)),
        ("rows", num(grid.rows as f64)),
        ("west", num(grid.west)),
        ("north", num(grid.north)),
        ("step", num(grid.step)),
        ("wrap", Val::Bool(grid.wrap)),
        ("flat", Val::Bool(grid.flat)),
        ("scale", num(grid.scale)),
        ("land", u8s(grid.land.clone())),
        ("region", i32s(grid.region.clone())),
        ("ids", list(grid.ids.iter().map(|id| text(id)).collect())),
        ("full", num(grid.full as f64)),
        ("stepKm", Val::obj([("along", f64s(grid.step_km.along.clone())), ("aslant", f64s(grid.step_km.aslant.clone())), ("down", num(grid.step_km.down))])),
        ("rowCosine", f64s(grid.row_cosine.clone())),
    ]);
    if let (Some(seas), Val::Obj(obj)) = (&grid.seas, &mut out) {
        obj.set("seas", i32s(seas.clone()));
        obj.set("seaCount", num(grid.sea_count as f64));
    }
    out
}

pub fn points_of(value: &Val) -> Vec<[f64; 2]> {
    value.array_or_empty().iter().map(|point| [point.element(0).num(), point.element(1).num()]).collect()
}

fn water_of(value: &Val) -> Option<Vec<String>> {
    match value {
        Val::Set(items) | Val::Arr(items) => Some(items.iter().filter_map(|item| item.as_str().map(|s| s.to_string())).collect()),
        _ => None,
    }
}

fn placed_val(placed: Option<Placed>) -> Val {
    match placed {
        Some(p) => Val::obj([("lng", num(p.lng)), ("lat", num(p.lat)), ("leg", num(p.leg as f64)), ("bearing", num(p.bearing))]),
        None => Val::Null,
    }
}

#[test]
fn world_grid_matches_js() {
    run(
        "worldGrid",
        &[
            ("kmBetween", &|case| expect(case, num(km_between(case.arg(0).num(), case.arg(1).num(), case.arg(2).num(), case.arg(3).num(), surface_of(case.arg(4)))))),
            ("greatPoint", &|case| expect(case, nums(&great_point(case.arg(0).num(), case.arg(1).num(), case.arg(2).num(), case.arg(3).num(), case.arg(4).num())))),
            ("worldSheetKey", &|case| {
                let water = water_of(case.arg(1));
                expect(case, text(&world_sheet_key(&arg_text(case.arg(0)), water.as_deref())))
            }),
            ("buildWorldGrid", &|case| {
                let options = case.arg(1);
                let grid = build_world_grid(
                    case.arg(0).array_or_empty(),
                    &GridOptions {
                        flat: options.get("flat").truthy(),
                        scale: if options.get("scale").is_undef() { None } else { Some(options.get("scale").num()) },
                        step: if options.get("step").is_undef() { 0.0 } else { options.get("step").num() },
                        water: water_of(options.get("water")).filter(|_| matches!(options.get("water"), Val::Set(items) if !items.is_empty())),
                    },
                );
                let got = grid.as_ref().map(grid_val).unwrap_or(Val::Null);
                let verdict = expect(case, got)?;
                if verdict.is_err() {
                    return Some(verdict);
                }
                let grid = match grid {
                    Some(grid) => grid,
                    None => return Some(Ok(())),
                };
                Some(
                    crate::support::Case::replay(case.methods("cellOf"), |a| num(grid.cell_of(a[0].num(), a[1].num())))
                        .and_then(|_| crate::support::Case::replay(case.methods("centreOf"), |a| nums(&grid.centre_of(a[0].num()))))
                        .and_then(|_| crate::support::Case::replay(case.methods("km"), |a| num(grid.km(a[0].num(), a[1].num(), a[2].num(), a[3].num())))),
                )
            }),
            ("distanceTo", &|case| {
                let grid = grid_of(case.arg(0));
                let distance = distance_to(&grid, case.arg(1).num());
                Some(crate::support::Case::replay(&case.result_calls, |a| num(distance.km(a[0].num()))))
            }),
            ("seasOf", &|case| {
                let mut grid = grid_of(case.arg(0));
                let seas = seas_of(&mut grid).clone();
                let verdict = expect(case, Val::Typed(Typed::I32(seas)))?;
                let after = case.after.as_ref().map(|after| after[0].clone()).unwrap_or_else(|| case.arg(0).clone());
                Some(verdict.and_then(|_| {
                    same(&i32s(grid.seas.clone().unwrap_or_default()), after.get("seas"))?;
                    same(&num(grid.sea_count as f64), after.get("seaCount"))
                }))
            }),
            ("nearestCell", &|case| {
                let grid = grid_of(case.arg(0));
                let script = Script::new(case, "3");
                let found = nearest_cell(&grid, case.arg(1).num() as i64, case.arg(2).num(), |cell, ring| script.call(&[num(cell as f64), num(ring as f64)]).truthy());
                Some(expect(case, num(found as f64))?.and_then(|_| script.done()))
            }),
            ("placeAlong", &|case| {
                let points = points_of(case.arg(0));
                let found = if case.arg(0).as_array().is_none() { None } else { place_along(&points, case.arg(1).num(), surface_of(case.arg(2))) };
                expect(case, placed_val(found))
            }),
            ("wayKm", &|case| expect(case, num(way_km(&points_of(case.arg(0)), surface_of(case.arg(1)))))),
        ],
    );
}

fn way_val(way: &ohfronts::sim::wayfinder::Way) -> Val {
    use ohfronts::sim::wayfinder::Way;
    match way {
        Way::Error(error) => Val::obj([("error", text(error))]),
        Way::Found { way, km, start, start_km, end, landing, arrived } => Val::obj([
            ("way", list(way.iter().map(|p| nums(p)).collect())),
            ("km", num(*km)),
            ("start", nums(start)),
            ("startKm", num(*start_km)),
            ("end", nums(end)),
            ("landing", nums(landing)),
            ("arrived", Val::Bool(*arrived)),
        ]),
    }
}

#[test]
fn wayfinder_matches_js() {
    use ohfronts::sim::wayfinder::{find_way, Ask};
    run(
        "wayfinder",
        &[("findWay", &|case| {
            let options = case.arg(1);
            if !case.arg(0).truthy() {
                return None;
            }
            let mut grid = grid_of(case.arg(0));
            let holder = Script::new(case, "1.holderOf");
            let friendly = Script::new(case, "1.friendly");
            let hostile = Script::new(case, "1.hostile");
            let point = |value: &Val| value.as_array().map(|_| [value.element(0).num(), value.element(1).num()]);
            let has = |key: &str| matches!(options.get(key), Val::Fn);
            let holder_of = |id: &str| if has("holderOf") { holder.call(&[text(id)]).string_or_empty() } else { String::new() };
            let is_friendly = |name: &str| has("friendly") && friendly.call(&[text(name)]).truthy();
            let is_hostile = |name: &str| has("hostile") && hostile.call(&[text(name)]).truthy();
            let medium = if options.get("medium").is_undef() { "sea".to_string() } else { options.get("medium").string() };
            let found = find_way(
                &mut grid,
                &Ask {
                    medium: &medium,
                    from: point(options.get("from")),
                    to: point(options.get("to")),
                    holder_of: &holder_of,
                    friendly: &is_friendly,
                    hostile: &is_hostile,
                    year: match options.get("year") {
                        Val::Num(n) => Some(*n),
                        _ => None,
                    },
                },
            );
            Some(expect(case, way_val(&found))?.and_then(|_| holder.done()).and_then(|_| friendly.done()).and_then(|_| hostile.done()))
        })],
    );
}
