package models

// Key is a seeded lookup value (24 standard major/minor keys). Not
// book-inheritable — pieces within the same book routinely differ in key.
type Key struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// SheetType is a seeded lookup value (Lead Sheet, Solo Part, Ensemble
// Score, PVG Score). Book-inheritable.
type SheetType struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}
