use crate::field::field_val;
use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::battle::Battle;
use ohfronts::sim::js::Val;
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
