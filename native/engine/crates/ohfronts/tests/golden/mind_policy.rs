use crate::field::sectors_of;
use crate::fronts::*;
use crate::mind_features::feature_battle;
use crate::support::{self, *};
use ohfronts::sim::battle::Battle;
use ohfronts::sim::engine::Run;
use ohfronts::sim::field::Contour;
use ohfronts::sim::js::Val;
use ohfronts::sim::mind::net::Shape;
use ohfronts::sim::mind::policy::*;
use ohfronts::sim::staff::Today;

fn choice_val(choice: &StaffChoice) -> Val {
    Val::obj([("order", text(&choice.order)), ("sector", text(&choice.sector)), ("draft", Val::Bool(choice.draft)), ("action", num(choice.action as f64))])
}

fn troops_val(choice: &TroopChoice) -> Val {
    let troops = choice
        .troops
        .iter()
        .map(|order| {
            let picked = list(order.picked.iter().map(|&index| num(index as f64)).collect());
            match &order.way {
                Some(way) => Val::obj([("order", text(&order.order)), ("picked", picked), ("way", list(way.iter().map(|&point| point_val(point)).collect()))]),
                None => Val::obj([("order", text(&order.order)), ("picked", picked)]),
            }
        })
        .collect();
    Val::obj([("troops", list(troops)), ("said", nums(&choice.said))])
}

fn replay<F: Fn(&mut Battle, &Context, Option<&Run>, Option<usize>, usize) -> Val>(case: &Case, decide: F) -> Option<Result<(), String>> {
    if case.result_calls.is_empty() {
        return None;
    }
    for (at, (args, want)) in case.result_calls.iter().enumerate() {
        let given = args.get(3).map(|run| run.is_object()).unwrap_or(false);
        let mut host = bare_run();
        if given {
            host.battles = args[3].get("battles").array_or_empty().iter().map(|front| feature_battle(&host, front)).collect();
        }
        let mut battle = feature_battle(&host, &args[0]);
        battle.mind = args[0].get("mind").clone();
        let after = case.result_calls_after.get(at).cloned().flatten();
        if battle.mind_homes.borrow().is_none() {
            if let Some(after) = &after {
                if after[0].get("mindHomes").is_object() {
                    *battle.mind_homes.borrow_mut() = Some(arg_numbers(after[0].get("mindHomes")).iter().map(|&n| n as i8).collect());
                }
            }
        }
        let me = host.battles.iter().position(|front| front.name == battle.name && front.sides == battle.sides);
        let options = args.get(2).cloned().unwrap_or(Val::Undef);
        let today = options.get("today");
        let contour = Contour { x: arg_numbers(today.get("line").get("contour").get("x")), y: arg_numbers(today.get("line").get("contour").get("y")), ..Contour::default() };
        let sectors = if today.get("sectors").is_object() { Some(sectors_of(today.get("sectors"))) } else { None };
        let day = Today { contour: &contour, count: today.get("line").get("count").num() as usize, sectors: sectors.as_ref() };
        let key = options.get("key").string_or_empty();
        let context = Context { began: options.get("began").truthy(), today: if today.is_object() { Some(&day) } else { None }, key: &key };
        let got = decide(&mut battle, &context, if given { Some(&host) } else { None }, me, args[1].num() as usize);
        if let Err(error) = same(&got, want) {
            return Some(Err(format!("decision {at}: {error}")));
        }
        let mind_want = match &after {
            Some(after) if !after[0].get("mind").is_undef() => after[0].get("mind").clone(),
            _ => args[0].get("mind").clone(),
        };
        if let Err(error) = same(&battle.mind, &mind_want) {
            return Some(Err(format!("decision {at} mind: {error}")));
        }
    }
    Some(Ok(()))
}

#[test]
fn mind_policy_matches_js() {
    support::run(
        "mindPolicy",
        &[
            ("createStaffPolicy", &|case| {
                let given = case.arg(0);
                let prior = if given.get("prior").is_undef() { 0.0 } else { given.get("prior").num() };
                let policy = create_staff_policy(Shape::of(given.get("shape")), arg_numbers(given.get("params")), prior, given.get("drafts").is_true());
                replay(case, |battle, context, run, me, side| policy.decide(battle, side, context, run, me).map(|choice| choice_val(&choice)).unwrap_or(Val::Undef))
            }),
            ("createTroopPolicy", &|case| {
                let given = case.arg(0);
                let policy = create_troop_policy(Shape::of(given.get("shape")), arg_numbers(given.get("params")));
                replay(case, |battle, context, run, me, side| policy.decide(battle, side, context, run, me).map(|choice| troops_val(&choice)).unwrap_or(Val::Undef))
            }),
        ],
    );
}
