"use strict";
// Core type definitions for FAANG-level matcha recommendation system
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderStatus = exports.FlavorProfile = exports.MatchaGrade = void 0;
// Enums for better type safety
var MatchaGrade;
(function (MatchaGrade) {
    MatchaGrade["CEREMONIAL"] = "ceremonial";
    MatchaGrade["PREMIUM"] = "premium";
    MatchaGrade["CULINARY"] = "culinary";
    MatchaGrade["INGREDIENT"] = "ingredient";
})(MatchaGrade || (exports.MatchaGrade = MatchaGrade = {}));
var FlavorProfile;
(function (FlavorProfile) {
    FlavorProfile["SWEET"] = "sweet";
    FlavorProfile["UMAMI"] = "umami";
    FlavorProfile["BITTER"] = "bitter";
    FlavorProfile["GRASSY"] = "grassy";
    FlavorProfile["NUTTY"] = "nutty";
    FlavorProfile["CREAMY"] = "creamy";
    FlavorProfile["EARTHY"] = "earthy";
    FlavorProfile["FLORAL"] = "floral";
})(FlavorProfile || (exports.FlavorProfile = FlavorProfile = {}));
var ProviderStatus;
(function (ProviderStatus) {
    ProviderStatus["ACTIVE"] = "active";
    ProviderStatus["INACTIVE"] = "inactive";
    ProviderStatus["RATE_LIMITED"] = "rate_limited";
    ProviderStatus["ERROR"] = "error";
})(ProviderStatus || (exports.ProviderStatus = ProviderStatus = {}));
//# sourceMappingURL=index.js.map