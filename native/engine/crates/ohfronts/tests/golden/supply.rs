use ohfronts::sim::codec::decode_mask;
use ohfronts::sim::constants::{HOLDER_SIDE_A, HOLDER_SIDE_B};
use crate::field::field_val;
use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::battle::Battle;
use ohfronts::sim::js::{Obj, Val};
use ohfronts::sim::supply::*;

fn battle_like(case: &Case, battle: &Battle) -> Result<(), String> {
    let want = want_after(case, 0);
    same_parts(&supply_val(battle), &want, "battle")?;
    if let Some(field) = &battle.field {
        same_parts(&field_val(field), want.get("field"), "field")?;
    }
    troops_like(battle, &want)
}

fn with_battle<F: Fn(&mut Battle) -> Val>(case: &Case, call: F) -> Option<Result<(), String>> {
    let run = bare_run();
    let mut battle = pick_battle(&run, case.arg(0));
    let got = call(&mut battle);
    Some(expect(case, got)?.and_then(|_| battle_like(case, &battle)))
}

#[test]
fn supply_matches_js() {
    support::run(
        "supply",
        &[
            ("nearestOwner", &|case| {
                let run = bare_run();
                let battle = pick_battle(&run, case.arg(0));
                let side = case.arg(1).num() as usize;
                Some(Case::replay(&case.result_calls, |args| num(nearest_owner(&battle, side, args[0].num() as usize))))
            }),
            ("findPockets", &|case| with_battle(case, |battle| {
                find_pockets(battle);
                Val::Undef
            })),
            ("markPockets", &|case| with_battle(case, |battle| {
                mark_pockets(battle);
                Val::Undef
            })),
            ("settlePockets", &|case| with_battle(case, |battle| Val::Bool(settle_pockets(battle, &case.arg(1).string_or_empty())))),
            ("surrenderPocket", &|case| with_battle(case, |battle| {
                surrender_pocket(battle, case.arg(1).num() as usize, &case.arg(2).string_or_empty());
                Val::Undef
            })),
            ("refreshSupply", &|case| with_battle(case, |battle| {
                refresh_supply(battle, case.arg(1).num(), case.arg(2).num() as usize);
                Val::Undef
            })),
            ("markSupply", &|case| with_battle(case, |battle| {
                mark_supply(battle);
                Val::Undef
            })),
        ],
    );
}

fn piece_battle(cols: usize, rows: usize, holders: Vec<u8>, play: Vec<u8>, home: &[u8], row_km: Vec<f64>) -> Battle {
    let size = cols * rows;
    let mut arena = Obj::new();
    arena.set("cols", num(cols as f64));
    arena.set("rows", num(rows as f64));
    arena.set("size", num(size as f64));
    arena.set("region", u8s(home.iter().map(|&side| side + 1).collect()));
    let mut field = Obj::new();
    field.set("cols", num(cols as f64));
    field.set("rows", num(rows as f64));
    field.set("holders", u8s(holders));
    field.set("play", u8s(play));
    field.set("turns", num(1.0));
    let mut value = Obj::new();
    value.set("arena", Val::Obj(arena));
    value.set("field", Val::Obj(field));
    value.set("homeSide", i8s(vec![-1, HOLDER_SIDE_A as i8, HOLDER_SIDE_B as i8, -1]));
    value.set("siegeKey", text(""));
    let run = bare_run();
    let mut battle = pick_battle(&run, &Val::Obj(value));
    battle.place.row_km = row_km;
    battle
}

#[test]
fn home_province_feeds_its_body() {
    let path = format!("{}/../../../../src/runtime/fronts/testdata/home-province-pocket.json", env!("CARGO_MANIFEST_DIR"));
    let fixture: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let cols = fixture["cols"].as_u64().unwrap() as usize;
    let rows = fixture["rows"].as_u64().unwrap() as usize;
    let size = (cols * rows) as f64;
    let mask = |key: &str| decode_mask(fixture[key].as_str().unwrap(), size);
    let row_km: Vec<f64> = fixture["rowKm"].as_array().unwrap().iter().map(|km| km.as_f64().unwrap()).collect();
    let mut battle = piece_battle(cols, rows, mask("holders"), mask("play"), &mask("home"), row_km);
    let cell = fixture["probe"][1].as_u64().unwrap() as usize * cols + fixture["probe"][0].as_u64().unwrap() as usize;
    let b = HOLDER_SIDE_B as usize;
    assert_eq!(battle.field.as_ref().unwrap().holders[cell], b as u8);
    find_pockets(&mut battle);
    assert_eq!(battle.pocket_of.as_ref().unwrap()[b][cell], -1, "the southern body is no pocket");
    assert_eq!(battle.fed.as_ref().unwrap()[b][cell], 1, "and it is supplied");
    assert!(!battle.pockets.iter().any(|pocket| pocket.s == b && pocket.cells.unwrap_or(0.0) > 100.0), "no great body of theirs is cut off");
}

#[test]
fn scrap_inside_a_ring_feeds_nothing() {
    let (cols, rows) = (30usize, 12usize);
    let size = cols * rows;
    let (a, b) = (HOLDER_SIDE_A as u8, HOLDER_SIDE_B as u8);
    let mut holders = vec![b; size];
    let mut home = vec![b; size];
    let play = vec![1u8; size];
    for row in 0..rows {
        for col in 0..4 {
            holders[row * cols + col] = a;
            home[row * cols + col] = a;
        }
    }
    for row in 2..=9 {
        for col in 6..=16 {
            if row == 2 || row == 9 || col == 6 || col == 16 {
                holders[row * cols + col] = a;
            }
        }
    }
    for row in 4..=7 {
        for col in 8..=11 {
            home[row * cols + col] = 2;
        }
    }
    home[5 * cols + 9] = b;
    home[5 * cols + 10] = b;
    let mut battle = piece_battle(cols, rows, holders, play, &home, vec![16.0; rows]);
    find_pockets(&mut battle);
    let inside = 5 * cols + 12;
    assert_ne!(battle.pocket_of.as_ref().unwrap()[b as usize][inside], -1, "the ringed ground is a pocket");
    assert_eq!(battle.fed.as_ref().unwrap()[b as usize][20], 1, "and the rest of the country is fed");
}
