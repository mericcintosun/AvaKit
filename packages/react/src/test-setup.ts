import { configure } from "@testing-library/react";

// waitFor gives up after one second by default. That is plenty on an idle machine and
// too little when Turborepo runs every package's tests at once on a small CI runner:
// a state update that takes a few milliseconds on its own was seen to miss the
// deadline there. A passing test returns as soon as its condition holds, so the
// longer limit only changes how long a failing one takes to report.
configure({ asyncUtilTimeout: 5000 });
