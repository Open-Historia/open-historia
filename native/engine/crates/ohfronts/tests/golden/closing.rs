use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::closing::*;
use ohfronts::sim::js::Val;

#[test]
fn closing_matches_js() {
    let run = bare_run();
    let run = &run;
    support::run(
        "closing",
        &[
            ("liveOrder", &|case| expect(case, live_order(&troop_full(case.arg(0))).cloned().unwrap_or(Val::Null))),
            ("findPrey", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                find_prey(&mut battle);
                let books = battle.close.as_ref().unwrap();
                let want = want_after(case, 0);
                let got = books_val(books);
                let check = || -> Result<(), String> {
                    if let Val::Obj(keys) = want.get("close") {
                        for (key, value) in keys.entries() {
                            same(got.get(key), value).map_err(|error| format!("close.{key}: {error}"))?;
                        }
                    }
                    same(&num(battle.taken_cells), want.get("takenCells")).map_err(|error| format!("takenCells: {error}"))?;
                    troops_like(&battle, &want)
                };
                Some(expect_keys(case, Val::obj([("size", num(books.size as f64)), ("key", text(&books.key))]), &["size", "key"])?.and_then(|_| check()))
            }),
            ("drawIn", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                draw_in(&mut battle, case.arg(1).num() as usize, case.arg(2).num());
                Some(expect(case, Val::Undef)?.and_then(|_| troops_like(&battle, &want_after(case, 0))))
            }),
        ],
    );
}
