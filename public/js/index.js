import { guardClosed, updateSignupDeadline } from "./common.js";

updateSignupDeadline();

guardClosed(document.querySelector(".hero .actions"));
