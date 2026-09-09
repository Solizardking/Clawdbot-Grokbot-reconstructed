import {it,expect} from "vitest";
import {desktopPoint} from "./hosted-desktop";
it("maps scaled desktops and rejects letterbox areas",()=>{
  expect(desktopPoint(160,100,320,200)).toEqual({x:640,y:400});
  expect(desktopPoint(160,50,320,400)).toBeNull();
  expect(desktopPoint(160,200,320,400)).toEqual({x:640,y:400});
  expect(desktopPoint(20,100,600,200)).toBeNull();
  expect(desktopPoint(300,100,600,200)).toEqual({x:640,y:400});
  expect(desktopPoint(320,200,320,200)).toBeNull();
  expect(desktopPoint(NaN,0,320,200)).toBeNull();
});
