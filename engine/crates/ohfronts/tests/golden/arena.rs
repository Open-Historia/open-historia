use crate::frame::frame_of;
use crate::support::*;
use ohfronts::sim::arena::*;
use ohfronts::sim::js::{Typed, Val};
use ohfronts::sim::region_types::{is_water_type, water_type_ids};
use std::collections::HashMap;

fn shape_val(shape: &Shape) -> Val {
    Val::obj([
        ("polygons", list(shape.polygons.iter().map(|rings| list(rings.iter().map(|ring| f64s(ring.clone())).collect())).collect())),
        ("west", num(shape.west)),
        ("east", num(shape.east)),
        ("south", num(shape.south)),
        ("north", num(shape.north)),
    ])
}

fn city_val(city: &City) -> Val {
    Val::obj([
        ("name", text(&city.name)),
        ("x", num(city.x)),
        ("y", num(city.y)),
        ("cell", num(city.cell)),
        ("population", num(city.population)),
        ("capital", Val::Bool(city.capital)),
    ])
}

pub fn arena_val(arena: &Arena, frame: &Val) -> Val {
    Val::obj([
        ("key", text(&arena.key)),
        ("iced", arena.iced.clone().map(u8s).unwrap_or(Val::Null)),
        ("frame", frame.clone()),
        ("cols", num(arena.cols as f64)),
        ("rows", num(arena.rows as f64)),
        ("size", num(arena.size as f64)),
        ("region", Val::Typed(Typed::U16(arena.region.clone()))),
        ("ids", list(arena.ids.iter().map(|id| text(id)).collect())),
        ("names", list(arena.names.iter().map(|id| text(id)).collect())),
        ("indexOf", Val::Map(arena.ids.iter().skip(1).map(|id| (text(id), num(arena.index_of[id] as f64))).collect())),
        ("cells", i32s(arena.cells.clone())),
        ("area", f64s(arena.area.clone())),
        ("outside", f64s(arena.outside.clone())),
        ("speed", Val::Typed(Typed::F32(arena.speed.clone()))),
        ("regionSpeed", f64s(arena.region_speed.clone())),
        ("centreX", f64s(arena.centre_x.clone())),
        ("centreY", f64s(arena.centre_y.clone())),
        ("cities", list(arena.cities.iter().map(city_val).collect())),
    ])
}

pub fn arena_of(value: &Val) -> Arena {
    let numbers = |key: &str| arg_numbers(value.get(key));
    let ids: Vec<String> = value.get("ids").array_or_empty().iter().map(|id| id.string()).collect();
    let mut index_of = HashMap::new();
    if let Val::Map(entries) = value.get("indexOf") {
        for (key, at) in entries {
            index_of.insert(key.string(), at.num() as usize);
        }
    }
    Arena {
        key: value.get("key").string_or_empty(),
        iced: if value.get("iced").is_nullish() { None } else { Some(numbers("iced").iter().map(|&n| n as u8).collect()) },
        frame: frame_of(value.get("frame")),
        cols: value.get("cols").num() as usize,
        rows: value.get("rows").num() as usize,
        size: value.get("size").num() as usize,
        region: numbers("region").iter().map(|&n| n as u16).collect(),
        ids,
        names: value.get("names").array_or_empty().iter().map(|id| id.string()).collect(),
        index_of,
        cells: numbers("cells").iter().map(|&n| n as i32).collect(),
        area: numbers("area"),
        outside: numbers("outside"),
        speed: numbers("speed").iter().map(|&n| n as f32).collect(),
        region_speed: numbers("regionSpeed"),
        centre_x: numbers("centreX"),
        centre_y: numbers("centreY"),
        cities: value
            .get("cities")
            .array_or_empty()
            .iter()
            .map(|c| City { name: c.get("name").string(), x: c.get("x").num(), y: c.get("y").num(), cell: c.get("cell").num(), population: c.get("population").num(), capital: c.get("capital").is_true() })
            .collect(),
        place: std::cell::OnceCell::new(),
    }
}

fn rings_of(value: &Val) -> Vec<Vec<f64>> {
    value.array_or_empty().iter().map(arg_numbers).collect()
}

fn options_val(options: &Val) -> ArenaOptions {
    ArenaOptions {
        region_types: if options.get("regionTypes").is_undef() { Vec::new() } else { options.get("regionTypes").array_or_empty().to_vec() },
        cities: options.get("cities").clone(),
        terrain: if options.get("terrain").is_undef() { Val::Null } else { options.get("terrain").clone() },
        frozen: match options.get("frozen") {
            Val::Arr(list) => Some(list.iter().filter_map(|item| item.as_str().map(|s| s.to_string())).collect()),
            _ => None,
        },
    }
}

#[test]
fn region_types_match_js() {
    run(
        "regionTypes",
        &[
            ("isWaterType", &|case| expect(case, Val::Bool(is_water_type(case.arg(0))))),
            ("waterTypeIds", &|case| expect(case, Val::Set(water_type_ids(case.arg(0)).iter().map(|id| text(id)).collect()))),
        ],
    );
}

#[test]
fn arena_matches_js() {
    run(
        "arena",
        &[
            ("projectRegion", &|case| expect(case, shape_val(&project_region(&frame_of(case.arg(0)), case.arg(1))))),
            ("fillPolygon", &|case| {
                let rings = rings_of(case.arg(0));
                let a = |at: usize| case.arg(at).num();
                let (width, height) = (a(2) as usize, a(3) as usize);
                let (filled, grid) = match case.arg(1) {
                    Val::Typed(Typed::U16(grid)) => {
                        let mut grid = grid.clone();
                        let filled = fill_polygon(&rings, &mut grid, width, height, a(4), a(5), a(6), a(7) as u16);
                        (filled, Val::Typed(Typed::U16(grid)))
                    }
                    Val::Typed(Typed::U8(grid)) => {
                        let mut grid = grid.clone();
                        let filled = fill_polygon(&rings, &mut grid, width, height, a(4), a(5), a(6), a(7) as u8);
                        (filled, Val::Typed(Typed::U8(grid)))
                    }
                    _ => return None,
                };
                Some(expect(case, num(filled as f64))?.and_then(|_| expect_after(case, 1, &grid)))
            }),
            ("citiesInFrame", &|case| expect(case, list(cities_in_frame(&frame_of(case.arg(0)), case.arg(1)).iter().map(city_val).collect()))),
            ("rasterizeArena", &|case| {
                let arena = rasterize_arena(&frame_of(case.arg(0)), case.arg(1).array_or_empty(), &options_val(case.arg(2)));
                expect(case, arena_val(&arena, case.arg(0)))
            }),
            ("sampleRegions", &|case| {
                let arena = arena_of(case.arg(0));
                let area = case.arg(2);
                let script = Script::new(case, "4");
                let sampled = sample_regions(
                    &arena,
                    case.arg(1).array_or_empty(),
                    SampleBox { col0: area.get("col0").num(), row0: area.get("row0").num(), col1: area.get("col1").num(), row1: area.get("row1").num() },
                    case.arg(3).num(),
                    |value| script.call(&[num(value as f64)]).truthy(),
                );
                let got = Val::obj([
                    ("grid", Val::Typed(Typed::U16(sampled.grid))),
                    ("width", num(sampled.width)),
                    ("height", num(sampled.height)),
                    ("scale", num(sampled.scale)),
                ]);
                Some(expect(case, got)?.and_then(|_| script.done()))
            }),
            ("arenaFor", &|case| {
                let mut cache = HashMap::new();
                let frame_arg = case.arg(2);
                let got = arena_for(&mut cache, case.arg(1), &frame_of(frame_arg), case.arg(3)).map(|arena| arena_val(&arena, frame_arg)).unwrap_or(Val::Null);
                if matches!(case.result, Some(Val::Obj(_))) || got.is_nullish() {
                    expect(case, got)
                } else {
                    None
                }
            }),
        ],
    );
}
