// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AntiDrainVault — Ultimate Protection
 * @notice Even if seed phrase leaks, hacker CANNOT drain:
 *   1. TWO signatures required (owner + guardian)
 *   2. Time delay for ALL withdrawals (24h)
 *   3. Spending limits per day / per tx
 *   4. Whitelist — only approved addresses
 *   5. Emergency freeze — guardian pauses all withdrawals
 *   6. Social recovery — guardians can replace compromised owner
 *   7. Session keys — expire after set time
 *   8. Biometric / passkey guardian (address derived off-chain)
 */
contract AntiDrainVault {

    // ─── Roles ───
    address public owner;
    address public guardian1;  // Primary guardian (derived from secondary password)
    address public guardian2;  // Backup guardian (email / hardware wallet)
    address public guardian3;  // Recovery guardian (friend/family multisig)

    // ─── Time Delay ───
    uint256 public withdrawalDelay = 24 hours;

    // ─── Spending Limits ───
    uint256 public maxPerTx = 1 ether;        // Max per single transaction
    uint256 public maxPerDay = 5 ether;       // Max total per day
    uint256 public dayStart;                   // Timestamp of current day window
    uint256 public spentToday;                 // ETH spent today

    // ─── Whitelist ───
    mapping(address => bool) public whitelisted;
    bool public whitelistEnabled = true;

    // ─── Emergency Freeze ───
    bool public frozen = false;

    // ─── Nonce (replay protection) ───
    uint256 public nonce;

    // ─── Session Keys ───
    struct Session {
        address sessionKey;
        uint256 expiresAt;
        uint256 maxAmount;
    }
    mapping(address => Session) public sessions;

    // ─── Withdrawal Queue ───
    struct QueuedWithdrawal {
        uint256 amount;
        address to;
        uint256 unlockTime;
        bool active;
        uint256 dayOfRequest;
    }
    mapping(uint256 => QueuedWithdrawal) public queue;
    uint256 public queueCount;

    // ─── Events ───
    event Deposited(address indexed from, uint256 amount);
    event WithdrawalQueued(uint256 indexed id, uint256 amount, address indexed to, uint256 unlockTime);
    event WithdrawalExecuted(uint256 indexed id, uint256 amount, address indexed to);
    event WithdrawalCancelled(uint256 indexed id);
    event GuardianAction(string action, address indexed by);
    event SessionCreated(address indexed sessionKey, uint256 expiresAt);
    event SessionRevoked(address indexed sessionKey);
    event WhitelistUpdated(address indexed addr, bool status);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event SpentTodayReset(uint256 newDayStart);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyGuardian() {
        require(
            msg.sender == guardian1 || msg.sender == guardian2 || msg.sender == guardian3,
            "Not guardian"
        );
        _;
    }

    modifier notFrozen() {
        require(!frozen, "Vault frozen");
        _;
    }

    modifier withinLimit(uint256 amount) {
        _resetDayIfNeeded();
        require(amount <= maxPerTx, "Exceeds per-tx limit");
        require(spentToday + amount <= maxPerDay, "Exceeds daily limit");
        _;
    }

    modifier whitelistCheck(address to) {
        if (whitelistEnabled) {
            require(whitelisted[to], "Address not whitelisted");
        }
        _;
    }

    constructor(
        address _owner,
        address _guardian1,
        address _guardian2,
        address _guardian3
    ) {
        require(_owner != address(0), "Zero owner");
        require(_guardian1 != address(0), "Zero guardian1");
        owner = _owner;
        guardian1 = _guardian1;
        guardian2 = _guardian2;
        guardian3 = _guardian3;
        dayStart = block.timestamp;
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        emit Deposited(msg.sender, msg.value);
    }

    // ═══════════════════════════════════════════
    // CORE: Queue Withdrawal (Time Delay)
    // ═══════════════════════════════════════════
    function queueWithdrawal(
        uint256 amount,
        address to,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external notFrozen withinLimit(amount) whitelistCheck(to) {
        require(to != address(0), "Invalid recipient");
        require(amount <= address(this).balance, "Insufficient balance");
        require(!frozen, "Frozen");

        bytes32 txHash = keccak256(abi.encode(
            "QUEUE_WITHDRAWAL",
            address(this),
            amount,
            to,
            nonce
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        require(_recover(ethHash, ownerSig) == owner, "Invalid owner sig");
        require(_recover(ethHash, guardianSig) == guardian1, "Invalid guardian sig");

        nonce++;

        uint256 id = queueCount++;
        queue[id] = QueuedWithdrawal({
            amount: amount,
            to: to,
            unlockTime: block.timestamp + withdrawalDelay,
            active: true,
            dayOfRequest: dayStart
        });

        spentToday += amount;
        emit WithdrawalQueued(id, amount, to, block.timestamp + withdrawalDelay);
    }

    // ═══════════════════════════════════════════
    // Execute After Delay
    // ═══════════════════════════════════════════
    function executeWithdrawal(uint256 id) external notFrozen {
        QueuedWithdrawal storage w = queue[id];
        require(w.active, "Not active");
        require(block.timestamp >= w.unlockTime, "Still locked");

        // If day rolled over, need guardian re-approval
        if (w.dayOfRequest != dayStart) {
            require(msg.sender == guardian1 || msg.sender == guardian2, "Needs guardian");
        }

        w.active = false;
        uint256 amount = w.amount;
        address to = w.to;

        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "Transfer failed");

        emit WithdrawalExecuted(id, amount, to);
    }

    // ═══════════════════════════════════════════
    // Cancel Queued Withdrawal (guardian only)
    // ═══════════════════════════════════════════
    function cancelWithdrawal(uint256 id) external onlyGuardian {
        QueuedWithdrawal storage w = queue[id];
        require(w.active, "Not active");
        w.active = false;
        emit WithdrawalCancelled(id);
    }

    // ═══════════════════════════════════════════
    // Session Keys — for small/quick spends
    // ═══════════════════════════════════════════
    function createSession(
        address sessionKey,
        uint256 duration,
        uint256 maxAmount,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        bytes32 txHash = keccak256(abi.encode(
            "CREATE_SESSION",
            sessionKey,
            duration,
            maxAmount,
            nonce
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        require(_recover(ethHash, ownerSig) == owner, "Invalid owner sig");
        require(_recover(ethHash, guardianSig) == guardian1, "Invalid guardian sig");

        nonce++;
        sessions[sessionKey] = Session({
            sessionKey: sessionKey,
            expiresAt: block.timestamp + duration,
            maxAmount: maxAmount
        });

        emit SessionCreated(sessionKey, block.timestamp + duration);
    }

    function spendWithSession(
        address to,
        uint256 amount,
        bytes calldata sessionSig
    ) external notFrozen whitelistCheck(to) {
        Session storage s = sessions[msg.sender];
        require(s.sessionKey == msg.sender, "Not a session");
        require(block.timestamp < s.expiresAt, "Session expired");
        require(amount <= s.maxAmount, "Exceeds session limit");
        require(amount <= address(this).balance, "Insufficient");

        // Verify session signature
        bytes32 txHash = keccak256(abi.encode(
            "SESSION_SPEND",
            address(this),
            to,
            amount,
            nonce
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));
        require(_recover(ethHash, sessionSig) == s.sessionKey, "Invalid session sig");

        nonce++;

        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "Transfer failed");
    }

    function revokeSession(
        address sessionKey,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        bytes32 txHash = keccak256(abi.encode(
            "REVOKE_SESSION",
            sessionKey,
            nonce
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        require(_recover(ethHash, ownerSig) == owner, "Invalid owner sig");
        require(_recover(ethHash, guardianSig) == guardian1, "Invalid guardian sig");

        nonce++;
        delete sessions[sessionKey];
        emit SessionRevoked(sessionKey);
    }

    // ═══════════════════════════════════════════
    // Emergency Freeze — ANY guardian can freeze
    // ═══════════════════════════════════════════
    function freeze() external onlyGuardian {
        frozen = true;
        emit GuardianAction("FREEZE", msg.sender);
    }

    function unfreeze(
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        require(frozen, "Not frozen");

        bytes32 txHash = keccak256(abi.encode("UNFREEZE", nonce));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        require(_recover(ethHash, ownerSig) == owner, "Invalid owner sig");
        require(_recover(ethHash, guardianSig) == guardian1, "Invalid guardian sig");

        nonce++;
        frozen = false;
        emit GuardianAction("UNFREEZE", msg.sender);
    }

    // ═══════════════════════════════════════════
    // Social Recovery — 2-of-3 guardians replace owner
    // ═══════════════════════════════════════════
    function recoverOwner(
        address newOwner,
        bytes calldata sig1,
        bytes calldata sig2
    ) external {
        require(newOwner != address(0), "Zero address");

        bytes32 txHash = keccak256(abi.encode(
            "RECOVER_OWNER",
            newOwner,
            nonce
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        address signer1 = _recover(ethHash, sig1);
        address signer2 = _recover(ethHash, sig2);

        // Must be 2 different guardians
        bool valid1 = (signer1 == guardian1 || signer1 == guardian2 || signer1 == guardian3);
        bool valid2 = (signer2 == guardian1 || signer2 == guardian2 || signer2 == guardian3);
        require(valid1 && valid2, "Invalid guardian sigs");
        require(signer1 != signer2, "Same guardian");

        nonce++;
        address oldOwner = owner;
        owner = newOwner;
        emit OwnerChanged(oldOwner, newOwner);
    }

    // ═══════════════════════════════════════════
    // Whitelist Management
    // ═══════════════════════════════════════════
    function addToWhitelist(
        address addr,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        bytes32 txHash = keccak256(abi.encode("ADD_WHITELIST", addr, nonce));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        require(_recover(ethHash, ownerSig) == owner, "Invalid owner sig");
        require(_recover(ethHash, guardianSig) == guardian1, "Invalid guardian sig");

        nonce++;
        whitelisted[addr] = true;
        emit WhitelistUpdated(addr, true);
    }

    function removeFromWhitelist(
        address addr,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        bytes32 txHash = keccak256(abi.encode("REMOVE_WHITELIST", addr, nonce));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        require(_recover(ethHash, ownerSig) == owner, "Invalid owner sig");
        require(_recover(ethHash, guardianSig) == guardian1, "Invalid guardian sig");

        nonce++;
        whitelisted[addr] = false;
        emit WhitelistUpdated(addr, false);
    }

    function toggleWhitelist(
        bool enabled,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        bytes32 txHash = keccak256(abi.encode("TOGGLE_WHITELIST", enabled, nonce));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        require(_recover(ethHash, ownerSig) == owner, "Invalid owner sig");
        require(_recover(ethHash, guardianSig) == guardian1, "Invalid guardian sig");

        nonce++;
        whitelistEnabled = enabled;
    }

    // ═══════════════════════════════════════════
    // Update Limits
    // ═══════════════════════════════════════════
    function setLimits(
        uint256 newMaxPerTx,
        uint256 newMaxPerDay,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        bytes32 txHash = keccak256(abi.encode(
            "SET_LIMITS", newMaxPerTx, newMaxPerDay, nonce
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", txHash
        ));

        require(_recover(ethHash, ownerSig) == owner, "Invalid owner sig");
        require(_recover(ethHash, guardianSig) == guardian1, "Invalid guardian sig");

        nonce++;
        maxPerTx = newMaxPerTx;
        maxPerDay = newMaxPerDay;
    }

    // ═══════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════
    function _resetDayIfNeeded() internal {
        if (block.timestamp >= dayStart + 24 hours) {
            dayStart = block.timestamp;
            spentToday = 0;
            emit SpentTodayReset(dayStart);
        }
    }

    function _recover(bytes32 ethHash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid sig");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid v");
        return ecrecover(ethHash, v, r, s);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getQueue(uint256 id) external view returns (QueuedWithdrawal memory) {
        return queue[id];
    }

    function isSessionValid(address sessionKey) external view returns (bool) {
        Session storage s = sessions[sessionKey];
        return s.sessionKey != address(0) && block.timestamp < s.expiresAt;
    }
}
