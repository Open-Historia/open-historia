use crate::arena::arena_of;
use crate::frame::frame_of;
use crate::support::*;
use ohfronts::sim::attrition::*;
use ohfronts::sim::battle::{create_battle, Battle, Named, Opening, Tally};
use ohfronts::sim::engine::{create_run, Hooks, ManEntry, Run};
use ohfronts::sim::js::{self, OrdMap, Val};
use ohfronts::sim::manpower::*;
use ohfronts::sim::mechanics::read_mechanics;
use ohfronts::sim::troops::{create_troop, TroopSeed};
use std::rc::Rc;

struct Recorded {
    people: Vec<(Vec<Val>, Val)>,
    military: Vec<(Vec<Val>, Val)>,
}

fn lookup(calls: &[(Vec<Val>, Val)], name: &str) -> Val {
    calls.iter().find(|(args, _)| matches!(args.first(), Some(Val::Str(text)) if text == name)).map(|(_, result)| result.clone()).unwrap_or(Val::Undef)
}

impl Hooks for Recorded {
    fn people_of(&self, name: &str) -> Val {
        lookup(&self.people, name)
    }

    fn military_of(&self, name: &str) -> Val {
        lookup(&self.military, name)
    }
}

fn tally_of(value: &Val) -> Option<[Tally; 2]> {
    if !value.is_object() {
        return None;
    }
    let side = |at: usize| -> Tally {
        let mut tally = Tally::default();
        if let Val::Map(entries) = value.at(at) {
            for (owner, count) in entries {
                tally.by_owner.set(owner.num() as usize, count.num());
            }
        }
        tally
    };
    Some([side(0), side(1)])
}

pub fn battle_of(run: &Run, value: &Val) -> Battle {
    let sides = |at: usize| -> Vec<String> { value.get("sides").at(at).array_or_empty().iter().map(|m| m.string_or_empty()).collect() };
    let mut battle = create_battle(
        run,
        Opening { name: String::new(), war_id: Val::Undef, sides: [sides(0), sides(1)], frame: frame_of(&Val::Null), arena: Rc::new(arena_of(&Val::Null)), opened_date: Val::Undef, opened_day: Val::Undef },
    );
    battle.status = value.get("status").string_or_empty();
    for side in 0..2 {
        battle.gone[side] = match value.get("gone").at(side) {
            Val::Set(items) => items.iter().map(|item| item.num() as usize).collect(),
            _ => Vec::new(),
        };
        battle.troops[side] = value
            .get("troops")
            .at(side)
            .array_or_empty()
            .iter()
            .map(|troop| create_troop(TroopSeed { owner: troop.get("owner").num(), strength: troop.get("strength").num(), ..TroopSeed::default() }))
            .collect();
        battle.mended_by[side] = value.get("mendedBy").at(side).array_or_empty().iter().map(|points| if points.is_undef() { None } else { Some(points.num()) }).collect();
    }
    battle.named = value
        .get("named")
        .array_or_empty()
        .iter()
        .map(|entry| Named { s: entry.get("s").num() as usize, i: entry.get("i").num() as usize, name: entry.get("name").string_or_empty(), unit_id: entry.get("unitId").clone() })
        .collect();
    battle.lost_by = tally_of(value.get("lostBy"));
    battle.out_by = tally_of(value.get("outBy"));
    battle.harsh_by = tally_of(value.get("harshBy"));
    battle
}

pub fn run_of(case: &Case, value: &Val) -> Run {
    let military = case.calls("0.militaryOf").or_else(|| case.calls("0.input.militaryOf")).cloned().unwrap_or_default();
    let people = case.calls("0.input.peopleOf").cloned().unwrap_or_default();
    let mut run = create_run(Val::Obj(js::Obj::new()), Box::new(Recorded { people, military }));
    run.input = value.get("input").clone();
    run.mech = read_mechanics(value.get("mech"));
    run.men_each = value.get("menEach").num();
    run.manpower_share = value.get("manpowerShare").num();
    if let Val::Map(entries) = value.get("manpower") {
        let mut book = OrdMap::new();
        for (key, entry) in entries {
            book.set(key.string(), ManEntry { name: entry.get("name").string_or_empty(), drawn: entry.get("drawn").num(), returned: entry.get("returned").num() });
        }
        run.manpower = std::cell::RefCell::new(book);
    }
    {
        let mut mend = run.mend.borrow_mut();
        mend.day = if value.get("mendDay").is_undef() { None } else { Some(value.get("mendDay").num()) };
        if let Val::Map(entries) = value.get("mendLeft") {
            for (key, left) in entries {
                mend.left.set(key.string(), left.num());
            }
        }
    }
    let battles: Vec<Battle> = value.get("battles").array_or_empty().iter().map(|battle| battle_of(&run, battle)).collect();
    run.battles = battles;
    run
}

fn book_val(run: &Run) -> Val {
    Val::Map(
        run.manpower
            .borrow()
            .entries
            .iter()
            .map(|(key, entry)| (text(key), Val::obj([("name", text(&entry.name)), ("drawn", num(entry.drawn)), ("returned", num(entry.returned))])))
            .collect(),
    )
}

fn run_after(case: &Case, run: &Run, keys: &[&str]) -> Result<(), String> {
    let want = case.after.as_ref().map(|after| after[0].clone()).unwrap_or_else(|| case.arg(0).clone());
    let mend = run.mend.borrow();
    let got = Val::obj([
        ("manpower", book_val(run)),
        ("mendDay", mend.day.map(num).unwrap_or(Val::Undef)),
        ("mendLeft", Val::Map(mend.left.entries.iter().map(|(key, left)| (text(key), num(*left))).collect())),
    ]);
    same_keys(&got, &want, keys)
}

fn with_run<F: Fn(&Run) -> Val>(case: &Case, call: F, keys: &[&str]) -> Option<Result<(), String>> {
    let run = run_of(case, case.arg(0));
    let got = call(&run);
    Some(expect(case, got)?.and_then(|_| run_after(case, &run, keys)))
}

fn indexes_of(value: &Val) -> Option<Vec<usize>> {
    value.as_array().map(|list| list.iter().map(|item| item.num() as usize).collect())
}

#[test]
fn manpower_matches_js() {
    run(
        "manpower",
        &[
            ("menPerFormation", &|case| expect(case, men_per_formation(case.arg(0)).map(num).unwrap_or(Val::Undef))),
            ("menOf", &|case| with_run(case, |run| num(men_of(run, &arg_text(case.arg(1)))), &[])),
            ("shareOf", &|case| with_run(case, |run| num(share_of(run, &arg_text(case.arg(1)))), &[])),
            ("draw", &|case| with_run(case, |run| {
                draw(run, &arg_text(case.arg(1)), case.arg(2).num());
                Val::Undef
            }, &["manpower"])),
            ("giveBack", &|case| with_run(case, |run| {
                give_back(run, &arg_text(case.arg(1)), case.arg(2).num());
                Val::Undef
            }, &["manpower"])),
            ("servingOf", &|case| with_run(case, |run| num(serving_of(run, &arg_text(case.arg(1)))), &[])),
            ("formationsLeft", &|case| with_run(case, |run| num(formations_left(run, &arg_text(case.arg(1)))), &[])),
            ("partLeft", &|case| with_run(case, |run| num(part_left(run, &arg_text(case.arg(1)))), &[])),
            ("sideFormationsLeft", &|case| with_run(case, |run| num(side_formations_left(run, &battle_of(run, case.arg(1)), case.arg(2).num() as usize)), &[])),
            ("mendBudget", &|case| {
                let run = run_of(case, case.arg(0));
                mend_budget(&run, case.arg(1).num());
                Some(run_after(case, &run, &["mendDay", "mendLeft"]))
            }),
            ("sendHome", &|case| with_run(case, |run| {
                let indexes = indexes_of(case.arg(3));
                send_home(run, &battle_of(run, case.arg(1)), case.arg(2).num() as usize, indexes.as_deref());
                Val::Undef
            }, &["manpower"])),
            ("manpowerReport", &|case| with_run(case, |run| list(manpower_report(run).iter().map(|e| Val::obj([("name", text(&e.name)), ("drawn", num(e.drawn)), ("returned", num(e.returned))])).collect()), &[])),
        ],
    );
}

#[test]
fn attrition_matches_js() {
    run(
        "attrition",
        &[
            ("attritionReport", &|case| {
                with_run(
                    case,
                    |run| {
                        list(
                            attrition_report(run, case.arg(1).num())
                                .iter()
                                .map(|e| Val::obj([("name", text(&e.name)), ("lost", num(e.lost)), ("men", num(e.men)), ("troopDays", num(e.troop_days)), ("harshDays", num(e.harsh_days)), ("days", if case.arg(1).is_undef() { Val::Undef } else { num(e.days) })]))
                                .collect(),
                        )
                    },
                    &[],
                )
            }),
            ("battleAttrition", &|case| {
                let run = create_run(Val::Obj(js::Obj::new()), Box::new(ohfronts::sim::engine::NoHooks));
                let battle = battle_of(&run, case.arg(0));
                expect(case, battle_attrition(&battle).map(|lost| nums(&lost)).unwrap_or(Val::Null))
            }),
        ],
    );
}
