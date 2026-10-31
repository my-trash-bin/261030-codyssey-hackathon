// @ts-check
import { setTimeout as delay } from 'node:timers/promises';

export class Seek extends Error {}

// Playback state lives outside the page, so navigation cannot reset the controls.
export class Playback {
 constructor({ fast = false, publish }) {
  this.fast = fast;
  this.publish = publish;
  this.paused = false;
  this.stopped = false;
  this.target = null;
  this.current = null;
  this.elapsed = 0;
  this.completed = false;
  this.plan = [];
 }
 command(command) {
  if (command.type === 'seek' && this.plan.some((s) => s.id === command.id)) {
   this.target = command.id;
   this.paused = true;
  }
  if (command.type === 'pause') this.paused = true;
  if (command.type === 'play') this.paused = false;
  if (command.type === 'stop') this.stopped = true;
 }
 state() {
  return {
   plan: this.plan, current: this.current, paused: this.paused,
   completed: this.completed, seeking: this.target !== null, stopped: this.stopped, elapsed: this.elapsed,
  };
 }
 async check({ allowSeek = true } = {}) {
  if (this.stopped) throw Error('사용자가 시연을 종료했습니다.');
  if (allowSeek && this.target !== null) throw new Seek();
 }
 async hold(seconds = 4) {
  const duration = this.fast ? 100 : seconds * 1000;
  this.elapsed = 0;
  while (this.elapsed < duration) {
   await this.check();
   await this.publish(this.state());
   await delay(100);
   if (!this.paused) this.elapsed += 100;
  }
  // A pause arriving during the final tick must still prevent the next action.
  await this.ready();
 }
 async ready() {
  while (true) {
   await this.check();
   if (!this.paused) return;
   await this.publish(this.state());
   await delay(100);
  }
 }
}
