use crate::frame::frame_val;
use crate::support::*;
use ohfronts::sim::contact::*;
use ohfronts::sim::js::Val;

fn area_val(area: &Area) -> Val {
    Val::obj([("west", num(area.west)), ("south", num(area.south)), ("east", num(area.east)), ("north", num(area.north))])
}

fn contact_val(contact: &Contact) -> Val {
    Val::obj([("bounds", area_val(&contact.bounds)), ("lng", num(contact.lng)), ("lat", num(contact.lat))])
}

fn side_value(value: Val) -> Option<usize> {
    match value {
        Val::Num(n) if n == 0.0 => Some(0),
        Val::Num(n) if n == 1.0 => Some(1),
        _ => None,
    }
}

#[test]
fn contact_matches_js() {
    run(
        "contact",
        &[
            ("findContacts", &|case| {
                let script = Script::new(case, "1");
                let found = find_contacts(case.arg(0).array_or_empty(), |id| side_value(script.call(&[text(id)])), case.arg(2));
                Some(expect(case, list(found.iter().map(contact_val).collect()))?.and_then(|_| script.done()))
            }),
            ("contactAt", &|case| {
                let script = Script::new(case, "1");
                let found = contact_at(case.arg(0).array_or_empty(), |id| side_value(script.call(&[text(id)])), case.arg(2), case.arg(3).num(), case.arg(4).num());
                Some(expect(case, found.as_ref().map(contact_val).unwrap_or(Val::Null))?.and_then(|_| script.done()))
            }),
            ("middleOf", &|case| expect(case, nums(&middle_of(case.arg(0))))),
            ("frameForContact", &|case| {
                let b = case.arg(0).get("bounds");
                let area = Area { west: b.get("west").num(), south: b.get("south").num(), east: b.get("east").num(), north: b.get("north").num() };
                expect(case, frame_for_contact(area, case.arg(1)).as_ref().map(frame_val).unwrap_or(Val::Null))
            }),
        ],
    );
}
