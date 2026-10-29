use super::js::Val;

pub const MECHANICS: [&str; 9] = ["fatigue", "weather", "terrain", "walls", "muster", "military", "air", "supply", "attrition"];

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Mechanics {
    pub on: [bool; 9],
}

impl Mechanics {
    pub fn has(&self, key: &str) -> bool {
        MECHANICS.iter().position(|name| *name == key).map(|at| self.on[at]).unwrap_or(false)
    }

    pub fn fatigue(&self) -> bool {
        self.on[0]
    }

    pub fn weather(&self) -> bool {
        self.on[1]
    }

    pub fn terrain(&self) -> bool {
        self.on[2]
    }

    pub fn walls(&self) -> bool {
        self.on[3]
    }

    pub fn muster(&self) -> bool {
        self.on[4]
    }

    pub fn military(&self) -> bool {
        self.on[5]
    }

    pub fn air(&self) -> bool {
        self.on[6]
    }

    pub fn supply(&self) -> bool {
        self.on[7]
    }

    pub fn attrition(&self) -> bool {
        self.on[8]
    }
}

pub fn read_mechanics(value: &Val) -> Mechanics {
    let mut on = [false; 9];
    for (at, key) in MECHANICS.iter().enumerate() {
        on[at] = value.get(key).is_true();
    }
    Mechanics { on }
}

pub fn any_mechanic(mech: &Val) -> bool {
    MECHANICS.iter().any(|key| mech.get(key).is_true())
}

pub fn any_of(mech: &Mechanics) -> bool {
    mech.on.iter().any(|&on| on)
}
