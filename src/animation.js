// Animation state
let animating = false;
let animationId = null;

// Ease out cubic
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate a tape pulling out of its shelf slot.
 * @param {THREE.Mesh} mesh - The tape mesh
 * @param {THREE.Vector3} startPos - Initial position
 * @param {THREE.Quaternion} startRot - Initial rotation
 * @param {number} direction - 1 (pull out) or -1 (return)
 * @param {number} duration - seconds
 * @param {function} onComplete - callback
 */
export function animateTape(mesh, startPos, startRot, direction, duration = 0.3, onComplete) {
  if (animating && direction === 1) return; // don't interrupt another pull-out
  
  animating = true;
  const startTime = performance.now() / 1000;
  const pullDistance = 0.15;
  
  function frame() {
    const elapsed = performance.now() / 1000 - startTime;
    const t = Math.min(elapsed / duration, 1.0);
    const eased = easeOutCubic(t);
    
    // Move forward (out of shelf) or back
    if (direction === 1) {
      mesh.position.z = startPos.z + pullDistance * eased;
    } else {
      mesh.position.z = startPos.z + pullDistance * (1 - eased);
    }
    
    if (t < 1) {
      animationId = requestAnimationFrame(frame);
    } else {
      animating = false;
      animationId = null;
      if (onComplete) onComplete();
    }
  }
  
  animationId = requestAnimationFrame(frame);
}

export function cancelAnimation() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animating = false;
    animationId = null;
  }
}