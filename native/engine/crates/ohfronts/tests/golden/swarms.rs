use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::battle::Battle;
use ohfronts::sim::constants::SWARM_REAR_KM;
use ohfronts::sim::js::Val;
use ohfronts::sim::swarms::*;

fn sides_val(sides: &[Vec<usize>; 2]) -> Val {
    list(sides.iter().map(|side| list(side.iter().map(|&n| num(n as f64)).collect())).collect())
}

fn swarms_like(battle: &Battle, want: &Val) -> Result<(), String> {
    if want.get("swarms").is_undef() {
        return Ok(());
    }
    let got = list(battle.swarms.iter().map(|side| Val::Set(side.iter().map(|&n| num(n as f64)).collect())).collect());
    same(&got, want.get("swarms")).map_err(|error| format!("swarms: {error}"))
}

fn after_like(case: &Case, battle: &Battle) -> Result<(), String> {
    let want = want_after(case, 0);
    swarms_like(battle, &want)?;
    troops_like(battle, &want)
}

fn has_swarms(case: &Case) -> bool {
    !case.arg(0).get("swarms").is_undef()
}

#[test]
fn swarms_match_js() {
    let run = bare_run();
    let run = &run;
    support::run(
        "swarms",
        &[
            ("readSwarms", &|case| expect(case, sides_val(&read_swarms(case.arg(0))))),
            ("swarmsOfRecord", &|case| expect(case, sides_val(&swarms_of_record(case.arg(0))))),
            ("blockSteps", &|case| expect(case, list(block_steps(case.arg(0).num()).into_iter().map(point_val).collect()))),
            ("inSwarm", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, Val::Bool(in_swarm(&battle, case.arg(1).num() as usize, &troop_full(case.arg(2)))))
            }),
            ("swarmsKept", &|case| {
                if !has_swarms(case) {
                    return None;
                }
                let mut battle = pick_battle(run, case.arg(0));
                let kept = swarms_kept(&mut battle);
                Some(expect(case, sides_val(&kept))?.and_then(|_| swarms_like(&battle, &want_after(case, 0))))
            }),
            ("swarmMiddles", &|case| {
                if !has_swarms(case) {
                    return None;
                }
                let battle = pick_battle(run, case.arg(0));
                let middles = swarm_middles(&battle, case.arg(1).num() as usize);
                expect(case, Val::Map(middles.iter().map(|(command, middle)| (num(*command), Val::obj([("x", num(middle.x)), ("y", num(middle.y)), ("n", num(middle.n)), ("o", num(middle.o))]))).collect()))
            }),
            ("freeCommand", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, num(free_command(&battle, case.arg(1).num() as usize)))
            }),
            ("halfBlockKm", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, num(half_block_km(&battle, case.arg(1).num() as usize, case.arg(2).num())))
            }),
            ("placeBlock", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                place_block(&mut battle, case.arg(1).num() as usize, &indexes(case.arg(2)), case.arg(3).num(), case.arg(4).num());
                Some(expect(case, Val::Undef)?.and_then(|_| after_like(case, &battle)))
            }),
            ("rearOf", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                let rear = if case.arg(4).is_undef() { SWARM_REAR_KM } else { case.arg(4).num() };
                expect(case, point_val(rear_of(&mut battle, case.arg(1).num() as usize, case.arg(2).num(), case.arg(3).num(), rear)))
            }),
            ("swarmPlaceOf", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, swarm_place_of(&battle, case.arg(1).num() as usize, case.arg(2)).map(point_val).unwrap_or(Val::Null))
            }),
            ("gathersInSwarms", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, Val::Bool(gathers_in_swarms(&battle, case.arg(1).num() as usize, case.arg(2), case.arg(3))))
            }),
            ("gatherNewcomers", &|case| {
                if !has_swarms(case) {
                    return None;
                }
                let mut battle = pick_battle(run, case.arg(0));
                let count = gather_newcomers(&mut battle, case.arg(1).num() as usize, case.arg(2).num(), case.arg(3).num() as usize, case.arg(4));
                Some(expect(case, num(count as f64))?.and_then(|_| after_like(case, &battle)))
            }),
            ("raiseSwarms", &|case| {
                if !has_swarms(case) {
                    return None;
                }
                let mut battle = pick_battle(run, case.arg(0));
                let side = case.arg(1).num() as usize;
                let raised = case.arg(2).array_or_empty();
                let total = battle.troops[side].len();
                if raised.len() > total {
                    return None;
                }
                let first = total - raised.len();
                let want = case.arg(0).get("troops").at(side).array_or_empty();
                for (at, troop) in raised.iter().enumerate() {
                    if same(troop, &want[first + at]).is_err() {
                        return None;
                    }
                }
                let picked: Vec<usize> = (first..total).collect();
                raise_swarms(&mut battle, side, &picked);
                Some(expect(case, Val::Undef)?.and_then(|_| after_like(case, &battle)))
            }),
        ],
    );
}
