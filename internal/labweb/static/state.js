// Revision guards are independent from rendering and tested without a browser.
export class Workspace {
  constructor() { this.revision = 0; this.result = null; this.reviewed = false; }
  invalidate() { this.revision++; this.result = null; this.reviewed = false; }
  ticket() { return this.revision; }
  apply(ticket, result) {
    if (ticket !== this.revision) return false;
    this.result = result;
    this.reviewed = result.review.pass;
    return true;
  }
  edit() { this.revision++; this.reviewed = false; }
  review(ticket, review) {
    if (ticket !== this.revision || !this.result) return false;
    this.result.review = review;
    this.reviewed = review.pass;
    return true;
  }
  downloadable(confirmed) { return !!this.result && this.reviewed && confirmed; }
}
