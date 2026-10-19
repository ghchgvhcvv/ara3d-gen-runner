/** Landing page: plays the demo video in a lightbox (loaded only when asked for). */
const VIDEO = 'https://res.cloudinary.com/api-dev-test/video/upload/v1792362920/3d-gen-demo_nk2m1y.mp4';

const modal = document.querySelector<HTMLDialogElement>('.video-modal')!;
const video = modal.querySelector('video')!;

function open() {
  if (!video.src) video.src = VIDEO;
  modal.showModal();
  void video.play().catch(() => {
    /* autoplay blocked: the controls are there */
  });
}
function close() {
  video.pause();
  modal.close();
}

document.querySelectorAll('[data-video]').forEach((b) => b.addEventListener('click', open));
modal.querySelector('.close')!.addEventListener('click', close);
// Click outside the video closes it; Esc closes the dialog natively.
modal.addEventListener('click', (e) => e.target === modal && close());
modal.addEventListener('close', () => video.pause());
