import { fitGeoref, merc } from "../src/lib/georef.ts";
const a = [["Jämsä",61.864,25.19,112,608],["Sipoo",60.377,25.27,151,1453],["Joutsa",61.74,26.11,380,657],["Mäntyharju",61.418,26.879,532,887],["Pieksämäki",62.30,27.14,620,396],["Hamina",60.57,27.20,650,1290],["Juva",61.897,27.857,819,664]].map(([name,lat,lon,px,py]: any) => ({name,lat,lon,px,py}));
console.log(JSON.stringify(fitGeoref(a, 1170)));
